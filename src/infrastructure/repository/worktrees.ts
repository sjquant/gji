import { access } from "node:fs/promises";
import type { WorktreeEntry } from "../../domain/worktree/types.js";
import { runGit } from "../git/runner.js";

export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
	const [output, currentRoot] = await Promise.all([
		runGit(cwd, ["worktree", "list", "--porcelain"]),
		runGit(cwd, ["rev-parse", "--show-toplevel"]),
	]);
	const entries = output.split("\n\n").filter(Boolean);

	const worktrees = entries.flatMap((entry) => {
		if (findOptionalPorcelainValue(entry, "prunable") !== null) return [];

		const path = findPorcelainValue(entry, "worktree");
		const branchRef = findOptionalPorcelainValue(entry, "branch");

		return [
			{
				branch: branchRef ? branchRef.replace("refs/heads/", "") : null,
				isCurrent: path === currentRoot,
				path,
			},
		];
	});

	const accessible = await Promise.all(
		worktrees.map(async (worktree) => {
			try {
				await access(worktree.path);
				return worktree;
			} catch {
				return null;
			}
		}),
	);

	return accessible.filter(
		(worktree): worktree is WorktreeEntry => worktree !== null,
	);
}

function findPorcelainValue(block: string, key: string): string {
	const value = findOptionalPorcelainValue(block, key);

	if (!value) {
		throw new Error(`Missing '${key}' in git worktree output.`);
	}

	return value;
}

function findOptionalPorcelainValue(block: string, key: string): string | null {
	const line = block
		.split("\n")
		.find((candidate) => candidate.startsWith(`${key} `));

	if (!line) {
		return null;
	}

	return line.slice(key.length + 1);
}
