import type { ContextCardModel } from "../../application/worktree/context-card.js";
import type { WorktreeInfo } from "../../application/worktree/read-models.js";

export function renderContextCard(model: ContextCardModel): string {
	const { info, task } = model;
	const rows = [`┌ ${info.branch ?? "(detached)"}`];
	rows.push(`│ task   ${task}`);
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
