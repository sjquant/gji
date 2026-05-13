import { execFile } from "node:child_process";
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
	await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], {
		cwd: repoRoot,
		env: GIT_ENV,
	});
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

export function isWorktreeDirtyError(error: unknown): boolean {
	return (
		hasStderr(error) &&
		error.stderr.includes("contains modified or untracked files")
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
