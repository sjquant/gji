import { execFile } from "node:child_process";
import { mkdir, rm, rmdir } from "node:fs/promises";
import { promisify } from "node:util";

import { isAlreadyExistsError } from "../filesystem/fs-utils.js";
import { GIT_ENV, retryGitContention } from "../git/runner.js";
import { listWorktrees } from "../repository/worktrees.js";

const execFileAsync = promisify(execFile);

const BRANCH_CONFIG_CLEANUP_TIMEOUT_MS = 1_000;

export interface NewBranchOptions {
	startPoint?: string;
	track?: boolean;
}

export type WorktreeTarget =
	| { branch: string }
	| { branch: string; create: NewBranchOptions }
	| { detachedAt: string | undefined };

/**
 * Adds a worktree on a path no other process has claimed, leaving nothing it
 * created behind on failure.
 *
 * A new branch is created first because that is the only part of `git worktree add -b`
 * that writes the shared .git/config. Retrying it stays cheap and lets checkouts run in parallel.
 */
export async function addWorktree(
	repoRoot: string,
	worktreePath: string,
	target: WorktreeTarget,
): Promise<void> {
	await claimWorktreePath(worktreePath);
	if ("create" in target) {
		try {
			await createBranch(repoRoot, target.branch, target.create);
		} catch (error) {
			await rmdir(worktreePath).catch(() => undefined);
			throw error;
		}
	}
	const args =
		"branch" in target
			? [target.branch]
			: ["--detach", ...(target.detachedAt ? [target.detachedAt] : [])];
	try {
		// No forced locale: this runs the user's hooks. Contention errors in another
		// language are not retried, and fall through to the rollback below.
		await retryGitContention(() =>
			execFileAsync("git", ["worktree", "add", worktreePath, ...args], {
				cwd: repoRoot,
			}),
		);
	} catch (error) {
		// Git can fail after registering the worktree, for example in a post-checkout hook.
		await removeCreatedWorktree(
			repoRoot,
			worktreePath,
			"create" in target ? target.branch : undefined,
		);
		throw error;
	}
}

/** Best-effort rollback of a worktree, and of the branch if this run created it. */
export async function removeCreatedWorktree(
	repoRoot: string,
	worktreePath: string,
	createdBranch?: string,
): Promise<void> {
	await runLifecycleGit(repoRoot, [
		"worktree",
		"remove",
		"--force",
		worktreePath,
	]).catch(() => undefined);
	await rmdir(worktreePath).catch(() => undefined);
	if (createdBranch) await deleteCreatedBranch(repoRoot, createdBranch);
}

// Git accepts an empty target directory but does not claim it atomically, so
// without this, racing processes can both succeed on one path.
async function claimWorktreePath(worktreePath: string): Promise<void> {
	try {
		await mkdir(worktreePath);
	} catch (error) {
		if (!isAlreadyExistsError(error)) throw error;
		throw new Error(`target worktree path already exists: ${worktreePath}`);
	}
}

export async function createBranch(
	repoRoot: string,
	branch: string,
	options: NewBranchOptions = {},
): Promise<void> {
	const args = [
		"branch",
		...(options.track ? ["--track"] : []),
		branch,
		...(options.startPoint ? [options.startPoint] : []),
	];
	try {
		await retryGitContention(async () => {
			try {
				await execFileAsync("git", args, { cwd: repoRoot, env: GIT_ENV });
			} catch (error) {
				// Git creates the ref before writing tracking config, so this failure
				// leaves a branch that only this call can have created.
				if (isGitConfigLockError(error))
					await forceDeleteBranch(repoRoot, branch);
				throw error;
			}
		});
	} catch (error) {
		if (isGitConfigLockError(error))
			await removeBranchConfig(repoRoot, branch).catch(() => undefined);
		throw error;
	}
}

/** Best-effort rollback. Git refuses to delete a branch another worktree has checked out. */
export async function deleteCreatedBranch(
	repoRoot: string,
	branch: string,
): Promise<void> {
	try {
		await forceDeleteBranch(repoRoot, branch);
		await removeBranchConfig(repoRoot, branch);
	} catch {
		/* rollback best effort */
	}
}

// `git branch -D` only warns when it cannot update the config, and tracking
// config can be left partly written when `git branch` loses the lock midway.
async function removeBranchConfig(
	repoRoot: string,
	branch: string,
): Promise<void> {
	await runLifecycleGit(
		repoRoot,
		["config", "--remove-section", `branch.${branch}`],
		BRANCH_CONFIG_CLEANUP_TIMEOUT_MS,
	);
}

export async function removeWorktree(
	repoRoot: string,
	worktreePath: string,
): Promise<void> {
	await runLifecycleGit(repoRoot, ["worktree", "remove", worktreePath]);
}

export async function forceRemoveWorktree(
	repoRoot: string,
	worktreePath: string,
): Promise<void> {
	try {
		await removeWorktreeWithForce(repoRoot, worktreePath);
	} catch (error) {
		if (isSubmoduleWorktreeRemovalError(error)) {
			await deinitializeSubmodules(worktreePath);
			await removeWorktreeWithForce(repoRoot, worktreePath);
			return;
		}

		const worktreeIsStillRegistered = (await listWorktrees(repoRoot)).some(
			(worktree) => worktree.path === worktreePath,
		);
		if (worktreeIsStillRegistered) {
			throw error;
		}

		await rm(worktreePath, { force: true, recursive: true });
	}
}

async function removeWorktreeWithForce(
	repoRoot: string,
	worktreePath: string,
): Promise<void> {
	await runLifecycleGit(repoRoot, [
		"worktree",
		"remove",
		"--force",
		worktreePath,
	]);
}

async function deinitializeSubmodules(worktreePath: string): Promise<void> {
	await execFileAsync("git", ["submodule", "deinit", "--force", "--all"], {
		cwd: worktreePath,
		env: GIT_ENV,
	});
}

export async function deleteBranch(
	repoRoot: string,
	branch: string,
): Promise<void> {
	await runLifecycleGit(repoRoot, ["branch", "-d", branch]);
}

export async function forceDeleteBranch(
	repoRoot: string,
	branch: string,
): Promise<void> {
	await runLifecycleGit(repoRoot, ["branch", "-D", branch]);
}

export function isWorktreeForceRemovalError(error: unknown): boolean {
	if (!hasStderr(error)) {
		return false;
	}

	return (
		error.stderr.includes("contains modified or untracked files") ||
		isSubmoduleWorktreeRemovalError(error) ||
		isWorktreeDeletionError(error)
	);
}

export function isSubmoduleWorktreeRemovalError(error: unknown): boolean {
	return (
		hasStderr(error) &&
		error.stderr.includes(
			"working trees containing submodules cannot be moved or removed",
		)
	);
}

export function isWorktreeDeletionError(error: unknown): boolean {
	return hasStderr(error) && error.stderr.includes("failed to delete");
}

export function isBranchUnmergedError(error: unknown): boolean {
	return hasStderr(error) && error.stderr.includes("is not fully merged");
}

function hasStderr(error: unknown): error is { stderr: string } {
	return (
		error instanceof Error &&
		"stderr" in error &&
		typeof (error as { stderr: unknown }).stderr === "string"
	);
}

async function runLifecycleGit(
	repoRoot: string,
	args: string[],
	timeoutMs?: number,
): Promise<void> {
	await retryGitContention(
		() => execFileAsync("git", args, { cwd: repoRoot, env: GIT_ENV }),
		timeoutMs,
	);
}

function isGitConfigLockError(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.includes("could not lock config file")
	);
}
