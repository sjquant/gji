import type {
	WorktreeEntry,
	WorktreeInfo,
} from "../../domain/worktree/types.js";

export interface ContextCardDependencies {
	listWorktrees: (cwd: string) => Promise<WorktreeEntry[]>;
	readTask: (worktreePath: string) => Promise<{ task: string } | null>;
	readWorktreeInfo: (worktree: WorktreeEntry) => Promise<WorktreeInfo>;
}

export interface ContextCardModel {
	info: WorktreeInfo;
	task: string;
}

export async function loadContextCardModel(
	worktreePath: string,
	dependencies: ContextCardDependencies,
): Promise<ContextCardModel | null> {
	const worktree = (await dependencies.listWorktrees(worktreePath)).find(
		(entry) => entry.path === worktreePath,
	);
	if (!worktree) return null;

	const task = await dependencies.readTask(worktreePath);
	if (!task) return null;

	return {
		info: await dependencies.readWorktreeInfo(worktree),
		task: task.task,
	};
}
