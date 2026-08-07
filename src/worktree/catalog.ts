import {
	detectRepository,
	listWorktrees,
	type RepositoryContext,
	type WorktreeEntry,
} from "../repo.js";

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
