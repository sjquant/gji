import type { RepositoryContext } from "../../domain/repository/context.js";
import type { WorktreeEntry } from "../../domain/worktree/types.js";
import type { RepositoryPort } from "../../ports/repository.js";

export interface LinkedWorktreeContext {
	linkedWorktrees: WorktreeEntry[];
	repository: RepositoryContext;
}

export async function loadLinkedWorktrees(
	cwd: string,
	repositoryPort: RepositoryPort,
): Promise<LinkedWorktreeContext> {
	const repository = await repositoryPort.detectRepository(cwd);
	const linkedWorktrees = (await repositoryPort.listWorktrees(cwd)).filter(
		(worktree) => worktree.path !== repository.repoRoot,
	);

	return {
		linkedWorktrees,
		repository,
	};
}
