import { listWorktrees } from "./repo.js";
import { readTask } from "./task.js";
import { readWorktreeInfo, type WorktreeInfo } from "./worktree/info.js";

export async function renderContextCard(
	worktreePath: string,
): Promise<string | null> {
	const worktree = (await listWorktrees(worktreePath)).find(
		(entry) => entry.path === worktreePath,
	);
	if (!worktree) return null;
	const info = await readWorktreeInfo(worktree);
	const task = await readTask(worktreePath);
	if (!task) return null;
	const rows = [`┌ ${info.branch ?? "(detached)"}`];
	rows.push(`│ task   ${task.task}`);
	rows.push(`│ state  ${formatState(info)}`);
	if (info.lastCommitTimestamp !== null)
		rows.push(`│ last   ${formatLastCommit(info)}`);
	rows.push("└");
	return rows.join("\n");
}

function formatState(info: WorktreeInfo): string {
	return `${info.status}${info.upstream.kind === "tracked" ? ` · ↑${info.upstream.ahead} ↓${info.upstream.behind}` : ""}`;
}

function formatLastCommit(info: WorktreeInfo): string {
	return new Date(info.lastCommitTimestamp as number).toISOString();
}
