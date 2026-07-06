import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";

import {
	detectRepository,
	listWorktrees,
	type RepositoryContext,
	type WorktreeEntry,
} from "./repo.js";

const execFileAsync = promisify(execFile);

// Force English output so error message string matching is locale-independent.
const GIT_ENV = { ...process.env, LC_ALL: "C" };

export interface LinkedWorktreeContext {
	linkedWorktrees: WorktreeEntry[];
	repository: RepositoryContext;
}

export async function loadLinkedWorktrees(
	cwd: string,
): Promise<LinkedWorktreeContext> {
	const repository = await detectRepository(cwd);
	const linkedWorktrees = (await listWorktrees(cwd)).filter(
		(worktree) => worktree.path !== repository.repoRoot,
	);

	return {
		linkedWorktrees,
		repository,
	};
}

export async function removeWorktree(
	repoRoot: string,
	worktreePath: string,
): Promise<void> {
	await execFileAsync("git", ["worktree", "remove", worktreePath], {
		cwd: repoRoot,
		env: GIT_ENV,
	});
}

export async function forceRemoveWorktree(
	repoRoot: string,
	worktreePath: string,
): Promise<void> {
	try {
		await execFileAsync(
			"git",
			["worktree", "remove", "--force", worktreePath],
			{
				cwd: repoRoot,
				env: GIT_ENV,
			},
		);
	} catch (error) {
		if (await isRegisteredWorktree(repoRoot, worktreePath)) {
			throw error;
		}

		await rm(worktreePath, { force: true, recursive: true });
	}
}

export async function deleteBranch(
	repoRoot: string,
	branch: string,
): Promise<void> {
	await execFileAsync("git", ["branch", "-d", branch], {
		cwd: repoRoot,
		env: GIT_ENV,
	});
}

export async function forceDeleteBranch(
	repoRoot: string,
	branch: string,
): Promise<void> {
	await execFileAsync("git", ["branch", "-D", branch], {
		cwd: repoRoot,
		env: GIT_ENV,
	});
}

export function isWorktreeForceRemovalError(error: unknown): boolean {
	if (!hasStderr(error)) {
		return false;
	}

	return (
		error.stderr.includes("contains modified or untracked files") ||
		error.stderr.includes("failed to delete")
	);
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

async function isRegisteredWorktree(
	repoRoot: string,
	worktreePath: string,
): Promise<boolean> {
	const worktrees = await listWorktrees(repoRoot);

	return worktrees.some((worktree) => worktree.path === worktreePath);
}
