import { comparePaths } from "./paths.js";
import { listWorktrees, type WorktreeEntry } from "./repo.js";
import {
	formatLastCommit,
	formatUpstreamState,
	readWorktreeInfos,
	type WorktreeInfo,
} from "./worktree-info.js";

export interface LsCommandOptions {
	compact?: boolean;
	cwd: string;
	json?: boolean;
	stdout: (chunk: string) => void;
}

export async function runLsCommand(options: LsCommandOptions): Promise<number> {
	const worktrees = sortWorktrees(await listWorktrees(options.cwd));

	if (options.compact) {
		if (options.json) {
			options.stdout(`${JSON.stringify(worktrees, null, 2)}\n`);
			return 0;
		}

		options.stdout(`${formatWorktreeTable(worktrees)}\n`);
		return 0;
	}

	const infos = await readWorktreeInfos(worktrees);

	if (options.json) {
		options.stdout(`${JSON.stringify(infos, null, 2)}\n`);
		return 0;
	}

	options.stdout(`${formatDetailedWorktreeTable(infos)}\n`);

	return 0;
}

export function formatDetailedWorktreeTable(worktrees: WorktreeInfo[]): string {
	const rows = worktrees.map((worktree) => ({
		branch: worktree.branch ?? "(detached)",
		isCurrent: worktree.isCurrent,
		lastCommit: formatLastCommit(worktree.lastCommitTimestamp),
		path: worktree.path,
		status: worktree.status,
		upstream: formatUpstreamState(worktree.upstream),
	}));
	const branchWidth = Math.max(
		"BRANCH".length,
		...rows.map((row) => row.branch.length),
	);
	const statusWidth = Math.max(
		"STATUS".length,
		...rows.map((row) => row.status.length),
	);
	const upstreamWidth = Math.max(
		"UPSTREAM".length,
		...rows.map((row) => row.upstream.length),
	);
	const lastCommitWidth = Math.max(
		"LAST".length,
		...rows.map((row) => row.lastCommit.length),
	);
	const lines = [
		"  " +
			"BRANCH".padEnd(branchWidth, " ") +
			" " +
			"STATUS".padEnd(statusWidth, " ") +
			" " +
			"UPSTREAM".padEnd(upstreamWidth, " ") +
			" " +
			"LAST".padEnd(lastCommitWidth, " ") +
			" PATH",
	];

	for (const row of rows) {
		lines.push(
			`${row.isCurrent ? "*" : " "} ` +
				`${row.branch.padEnd(branchWidth, " ")} ` +
				`${row.status.padEnd(statusWidth, " ")} ` +
				`${row.upstream.padEnd(upstreamWidth, " ")} ` +
				`${row.lastCommit.padEnd(lastCommitWidth, " ")} ` +
				row.path,
		);
	}

	return lines.join("\n");
}

export function formatWorktreeTable(worktrees: WorktreeEntry[]): string {
	const rows = worktrees.map((worktree) => ({
		branch: worktree.branch ?? "(detached)",
		isCurrent: worktree.isCurrent,
		path: worktree.path,
	}));
	const branchWidth = Math.max(
		"BRANCH".length,
		...rows.map((row) => row.branch.length),
	);
	const lines = ["  " + "BRANCH".padEnd(branchWidth, " ") + " PATH"];

	for (const row of rows) {
		lines.push(
			`${row.isCurrent ? "*" : " "} ${row.branch.padEnd(branchWidth, " ")} ${row.path}`,
		);
	}

	return lines.join("\n");
}

function sortWorktrees(worktrees: WorktreeEntry[]): WorktreeEntry[] {
	return [...worktrees].sort((left, right) => {
		if (left.isCurrent && !right.isCurrent) return -1;
		if (!left.isCurrent && right.isCurrent) return 1;
		return comparePaths(left.path, right.path);
	});
}
