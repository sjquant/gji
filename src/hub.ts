import { basename } from "node:path";
import { stdin, stdout } from "node:process";

import { spinner } from "@clack/prompts";
import { loadHistory } from "./history.js";
import {
	createPullRequestQuery,
	type PullRequestInfo,
} from "./pull-requests.js";
import { detectRepository } from "./repo.js";
import {
	middleEllipsize,
	sanitizeTerminalText,
	terminalWidth,
} from "./terminal-text.js";
import {
	formatRelativeAge,
	formatUpstreamState,
	readWorktreeInfos,
	type WorktreeInfo,
} from "./worktree-info.js";
import type { WorktreeSource } from "./worktree-source.js";
import { listDiscoverableWorktreeSources } from "./worktree-sources.js";

const MAX_HUB_REPOSITORY_CONCURRENCY = 4;

export interface HubCommandOptions {
	cwd: string;
	columns?: number;
	json?: boolean;
	now?: number;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export interface HubCommandDependencies {
	queryRepositoryPullRequests: (repoRoot: string) => Promise<PullRequestInfo[]>;
}

export interface HubWorktree extends WorktreeInfo {
	lastUsedTimestamp: number | null;
	pullRequests: PullRequestInfo[];
}

export interface HubRepository {
	current: boolean;
	name: string;
	pullRequests: PullRequestInfo[];
	root: string;
	worktrees: HubWorktree[];
}

export interface HubData {
	currentRepository: string | null;
	repositories: HubRepository[];
}

const defaultDependencies: HubCommandDependencies = {
	queryRepositoryPullRequests:
		createPullRequestQuery().listOpenPullRequestsForRepository,
};

export async function buildHubData(
	cwd: string,
	dependencies: Partial<HubCommandDependencies> = {},
): Promise<HubData> {
	const queryRepositoryPullRequests =
		dependencies.queryRepositoryPullRequests ??
		defaultDependencies.queryRepositoryPullRequests;
	const currentRepository = await detectRepository(cwd).catch(() => null);
	const history = await loadHistory();
	const lastUsedByPath = new Map(
		history.map((entry) => [entry.path, entry.timestamp]),
	);
	const sources = await listDiscoverableWorktreeSources(cwd);
	const groups = new Map<string, { name: string; sources: WorktreeSource[] }>();

	for (const source of sources) {
		if (!source.repoRoot) continue;
		const repoRoot = source.repoRoot;
		const existing = groups.get(repoRoot);
		if (existing) {
			existing.sources.push(source);
		} else {
			groups.set(repoRoot, {
				name: source.repoName || basename(repoRoot),
				sources: [source],
			});
		}
	}

	const repositories = await mapWithConcurrency(
		[...groups.entries()],
		MAX_HUB_REPOSITORY_CONCURRENCY,
		async ([root, group]) => {
			const infos = await readWorktreeInfos(
				group.sources.map((source) => source.worktree),
			);
			let pullRequests: PullRequestInfo[] = [];
			try {
				pullRequests = await queryRepositoryPullRequests(root);
			} catch {
				// PR metadata is optional. The hub remains useful when a provider is unavailable.
			}
			const worktrees = infos.map((info) => ({
				...info,
				lastUsedTimestamp: lastUsedByPath.get(info.path) ?? null,
				pullRequests: pullRequests.filter(
					(pullRequest) => pullRequest.sourceBranch === info.branch,
				),
			}));

			return {
				current: currentRepository?.repoRoot === root,
				name: group.name,
				pullRequests,
				root,
				worktrees,
			};
		},
	);

	repositories.sort((left, right) => {
		if (left.current !== right.current) return left.current ? -1 : 1;
		return left.name.localeCompare(right.name);
	});

	return {
		currentRepository: currentRepository?.repoRoot ?? null,
		repositories,
	};
}

export async function runHubCommand(
	options: HubCommandOptions,
	dependencies: Partial<HubCommandDependencies> = {},
): Promise<number> {
	const loading =
		!options.json && stdin.isTTY === true && stdout.isTTY === true
			? spinner()
			: null;
	loading?.start("Loading worktrees");

	let data: HubData;
	try {
		data = await buildHubData(options.cwd, dependencies);
	} finally {
		loading?.stop();
	}

	if (options.json) {
		options.stdout(`${JSON.stringify(data, null, 2)}\n`);
		return 0;
	}
	options.stdout(
		`${formatHubOutput(
			data,
			options.columns ?? process.stdout.columns ?? 80,
			options.now ?? Date.now(),
		)}\n`,
	);
	return 0;
}

export function formatHubOutput(
	data: HubData,
	columns = process.stdout.columns ?? 80,
	now = Date.now(),
): string {
	if (data.repositories.length === 0) {
		return "No registered repositories. Run gji from a repository to add one.";
	}

	const lineWidth = Math.max(1, columns);
	const allWorktrees = data.repositories.flatMap((repository) =>
		repository.worktrees.map((worktree) => ({ repository, worktree })),
	);
	const attention = allWorktrees.filter(({ worktree }) =>
		isActionable(worktree),
	);
	const current =
		allWorktrees.find(({ worktree }) => worktree.isCurrent) ?? null;
	const next = chooseNextWorktree(allWorktrees);
	const remainingAttention = attention.filter(
		(entry) => entry !== current && entry !== next,
	);
	const quiet = allWorktrees.filter(
		(entry) =>
			entry !== current && entry !== next && !attention.includes(entry),
	);
	const recentOther = [...quiet]
		.sort(
			(left, right) =>
				(right.worktree.lastCommitTimestamp ?? 0) -
				(left.worktree.lastCommitTimestamp ?? 0),
		)
		.slice(0, 5);
	const hiddenCount = quiet.length - recentOther.length;
	const lines = [
		`GJI  ${data.repositories.length} repositories · ${allWorktrees.length} worktrees${
			attention.length > 0 ? ` · ${attention.length} need attention` : ""
		}`,
		"",
	];

	if (data.repositories.length > 1) {
		lines.push("REPOSITORIES");
		for (const repository of data.repositories) {
			lines.push(formatRepositorySummary(repository, lineWidth));
		}
		lines.push("");
	}

	if (current !== null) {
		lines.push("CURRENT");
		lines.push(...formatHubWorktree(current, lineWidth, "@", now));
		lines.push("");
	}

	if (next !== null && next !== current) {
		lines.push("NEXT");
		lines.push(...formatHubWorktree(next, lineWidth, "›", now));
		lines.push("");
	}

	if (remainingAttention.length > 0) {
		lines.push("ATTENTION");
		for (const entry of remainingAttention) {
			lines.push(...formatHubWorktree(entry, lineWidth, "!", now));
		}
		lines.push("");
	}

	if (recentOther.length > 0) {
		lines.push("OTHER");
		for (const entry of recentOther) {
			lines.push(...formatHubWorktree(entry, lineWidth, " ", now));
		}
		if (hiddenCount > 0) {
			lines.push(
				`  ${hiddenCount} quiet worktree${hiddenCount === 1 ? "" : "s"} hidden`,
			);
		}
		lines.push("");
	}

	if (
		next === null &&
		remainingAttention.length === 0 &&
		recentOther.length === 0
	) {
		lines.push("No active worktrees.");
	}

	lines.push("Run `gji go <repo>/<branch>` to switch worktrees.");

	return lines
		.map((line) =>
			terminalWidth(line) > lineWidth ? middleEllipsize(line, lineWidth) : line,
		)
		.join("\n")
		.trimEnd();
}

function formatRepositorySummary(
	repository: HubRepository,
	lineWidth: number,
): string {
	const attentionCount = repository.worktrees.filter(isActionable).length;
	const attention =
		attentionCount === 0 ? "healthy" : `${attentionCount} attention`;
	const marker = repository.current ? "*" : " ";
	return middleEllipsize(
		`${marker} ${repository.name} · ${repository.worktrees.length} worktree${repository.worktrees.length === 1 ? "" : "s"} · ${attention}`,
		lineWidth,
	);
}

function chooseNextWorktree(
	entries: Array<{ repository: HubRepository; worktree: HubWorktree }>,
): { repository: HubRepository; worktree: HubWorktree } | null {
	return (
		[...entries].sort((left, right) => {
			const scoreDifference =
				nextWorktreeScore(right) - nextWorktreeScore(left);
			if (scoreDifference !== 0) return scoreDifference;
			const lastUsedDifference =
				(right.worktree.lastUsedTimestamp ?? 0) -
				(left.worktree.lastUsedTimestamp ?? 0);
			if (lastUsedDifference !== 0) return lastUsedDifference;
			return (
				(right.worktree.lastCommitTimestamp ?? 0) -
				(left.worktree.lastCommitTimestamp ?? 0)
			);
		})[0] ?? null
	);
}

function nextWorktreeScore(entry: {
	repository: HubRepository;
	worktree: HubWorktree;
}): number {
	const { worktree } = entry;
	let score =
		worktree.isCurrent && (worktree.task !== null || isActionable(worktree))
			? 100
			: 0;
	if (worktree.task !== null) score += 40;
	if (worktree.status === "dirty") score += 30;
	if (worktree.upstream.kind === "stale") score += 25;
	if (worktree.upstream.kind === "tracked" && worktree.upstream.behind > 0) {
		score += 25;
	}
	if (worktree.pullRequests.length > 0) score += 20;
	if (worktree.lastUsedTimestamp !== null && worktree.lastUsedTimestamp > 0) {
		score += 15;
	}
	return score;
}

function isActionable(worktree: HubWorktree): boolean {
	return (
		worktree.status === "dirty" ||
		worktree.upstream.kind === "stale" ||
		(worktree.upstream.kind === "tracked" && worktree.upstream.behind > 0) ||
		worktree.pullRequests.length > 0
	);
}

function formatHubWorktree(
	entry: { repository: HubRepository; worktree: HubWorktree },
	lineWidth: number,
	marker: string,
	now: number,
): string[] {
	const { repository, worktree } = entry;
	const branch = worktree.branch ?? "(detached)";
	const status = [
		formatWorktreeHealth(worktree),
		formatWorktreeUpstream(worktree),
		worktree.pullRequests.length > 0
			? worktree.pullRequests
					.map((pullRequest) =>
						pullRequest.title
							? `#${pullRequest.number} ${formatHumanText(pullRequest.title, 60)}`
							: `#${pullRequest.number}`,
					)
					.join(", ")
			: null,
		formatWorktreeActivity(worktree, now),
	]
		.filter((value): value is string => value !== null)
		.join(" · ");
	const task =
		worktree.task === null
			? null
			: `task: ${formatHumanText(worktree.task, 80)}`;
	const target = `${repository.name}/${branch}`;
	const lines = [`${marker} ${middleEllipsize(target, lineWidth - 2)}`];
	if (status.length > 0) {
		lines.push(`  ${middleEllipsize(status, lineWidth - 2)}`);
	}
	if (task !== null) {
		lines.push(`  ${middleEllipsize(task, lineWidth - 2)}`);
	}
	if (marker === "@" || marker === "›" || marker === "!") {
		lines.push(`  ${middleEllipsize(nextAction(worktree), lineWidth - 2)}`);
	}
	return lines;
}

function formatWorktreeHealth(worktree: HubWorktree): string | null {
	if (worktree.status === "dirty") return "! dirty";
	if (worktree.status === "unknown") return "? health unknown";
	return null;
}

function formatWorktreeUpstream(worktree: HubWorktree): string | null {
	if (worktree.upstream.kind === "stale") return "! stale upstream";
	if (
		worktree.upstream.kind === "tracked" &&
		(worktree.upstream.behind > 0 || worktree.upstream.ahead > 0)
	) {
		return formatUpstreamState(worktree.upstream);
	}
	return null;
}

function formatWorktreeActivity(
	worktree: HubWorktree,
	now: number,
): string | null {
	if (worktree.isCurrent) return null;
	const timestamps = [
		worktree.lastUsedTimestamp ?? 0,
		(worktree.lastCommitTimestamp ?? 0) * 1000,
	].filter((timestamp) => timestamp > 0);
	if (timestamps.length === 0) return null;
	const latest = Math.max(...timestamps);
	const ageSeconds = Math.floor((now - latest) / 1000);
	if (ageSeconds < 24 * 60 * 60) return null;
	return `inactive ${formatRelativeAge(
		Math.floor(latest / 1000),
		Math.floor(now / 1000),
	)}`;
}

function nextAction(worktree: HubWorktree): string {
	if (worktree.isCurrent && worktree.task !== null) {
		return "next: continue task";
	}
	if (worktree.status === "dirty") {
		return "next: switch → inspect changes";
	}
	if (
		worktree.upstream.kind === "stale" ||
		(worktree.upstream.kind === "tracked" && worktree.upstream.behind > 0)
	) {
		return "next: switch → sync";
	}
	const pullRequest = worktree.pullRequests[0];
	if (pullRequest !== undefined) {
		return `next: switch → open PR '#${pullRequest.number}'`;
	}
	return "next: switch worktree";
}

function formatHumanText(value: string, maxLength: number): string {
	const sanitized = sanitizeTerminalText(value);
	return sanitized.length <= maxLength
		? sanitized
		: `${sanitized.slice(0, Math.max(0, maxLength - 1))}…`;
}

async function mapWithConcurrency<Input, Output>(
	items: Input[],
	limit: number,
	mapper: (item: Input) => Promise<Output>,
): Promise<Output[]> {
	const results: Output[] = new Array(items.length);
	let nextIndex = 0;
	async function readNext(): Promise<void> {
		for (;;) {
			const index = nextIndex++;
			if (index >= items.length) return;
			results[index] = await mapper(items[index]);
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, () => readNext()),
	);
	return results;
}
