import { basename } from "node:path";

import { loadHistory } from "./history.js";
import {
	createPullRequestQuery,
	type PullRequestInfo,
} from "./pull-requests.js";
import { detectRepository } from "./repo.js";
import {
	formatUpstreamState,
	readWorktreeInfos,
	type WorktreeInfo,
} from "./worktree-info.js";
import {
	promptForSingleWorktree,
	type WorktreePromptEntry,
} from "./worktree-picker.js";
import type { WorktreeSource } from "./worktree-source.js";
import { listDiscoverableWorktreeSources } from "./worktree-sources.js";

const MAX_HUB_REPOSITORY_CONCURRENCY = 4;

export interface HubCommandOptions {
	cwd: string;
	json?: boolean;
	view?: HubView;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export type HubAttentionReason = "behind" | "dirty" | "prs" | "stale";

export type HubView =
	| { kind: "all" }
	| { kind: "attention"; reason?: HubAttentionReason }
	| { kind: "focused" }
	| { kind: "interactive" };

export interface HubCommandDependencies {
	queryRepositoryPullRequests: (repoRoot: string) => Promise<PullRequestInfo[]>;
}

export interface HubWorktree extends WorktreeInfo {
	lastUsedTimestamp?: number | null;
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
	const data = await buildHubData(options.cwd, dependencies);

	if (options.json) {
		options.stdout(`${JSON.stringify(data, null, 2)}\n`);
		return 0;
	}
	if (options.view?.kind === "interactive") {
		const selected = await promptForSingleWorktree(
			"Choose a worktree",
			buildHubPromptEntries(data),
		);
		if (selected === null) {
			options.stderr("No worktree selected.\n");
			return 1;
		}
		options.stdout(`${selected}\n`);
		return 0;
	}

	options.stdout(
		`${formatHubOutput(data, process.stdout.columns ?? 80, options.view)}\n`,
	);
	return 0;
}

function buildHubPromptEntries(data: HubData): WorktreePromptEntry[] {
	return data.repositories.flatMap((repository) =>
		repository.worktrees.map((worktree) => ({
			...worktree,
			group: worktree.lastUsedTimestamp === null ? "other" : "recent",
			label: `${repository.name}/${worktree.branch ?? "(detached)"}`,
			metadata: [
				worktree.status,
				formatUpstreamState(worktree.upstream),
				worktree.pullRequests.length > 0
					? worktree.pullRequests
							.map((pullRequest) => `#${pullRequest.number}`)
							.join(", ")
					: null,
			]
				.filter((value): value is string => value !== null)
				.join(" · "),
			repoName: repository.name,
		})),
	);
}

export function formatHubOutput(
	data: HubData,
	columns = process.stdout.columns ?? 80,
	view: HubView = { kind: "focused" },
): string {
	if (data.repositories.length === 0) {
		return "No registered repositories. Run gji from a repository to add one.";
	}

	const lineWidth = Math.max(20, columns);
	const allWorktrees = data.repositories.flatMap((repository) =>
		repository.worktrees.map((worktree) => ({ repository, worktree })),
	);
	const attention = allWorktrees.filter(({ worktree }) =>
		isActionable(worktree),
	);
	const visibleAttention =
		view.kind === "attention"
			? attention.filter(({ worktree }) => isActionable(worktree, view.reason))
			: attention;
	const current =
		allWorktrees.find(({ worktree }) => worktree.isCurrent) ?? null;
	const next = chooseNextWorktree(allWorktrees);
	const remainingAttention = visibleAttention.filter(
		(entry) => entry !== current && entry !== next,
	);
	const quiet = allWorktrees.filter(
		(entry) =>
			entry !== current && entry !== next && !visibleAttention.includes(entry),
	);
	const recentOther = [...quiet]
		.sort(
			(left, right) =>
				(right.worktree.lastCommitTimestamp ?? 0) -
				(left.worktree.lastCommitTimestamp ?? 0),
		)
		.slice(0, view.kind === "all" ? quiet.length : 5);
	const hiddenCount = quiet.length - recentOther.length;
	if (view.kind === "attention") {
		const lines = [
			`GJI ATTENTION${view.reason ? ` · ${view.reason}` : ""} · ${visibleAttention.length} worktree${visibleAttention.length === 1 ? "" : "s"}`,
			"",
		];
		for (const entry of visibleAttention) {
			lines.push(...formatHubWorktree(entry, lineWidth, "!"));
		}
		if (visibleAttention.length === 0) {
			lines.push("No worktrees need attention.");
		}
		lines.push("", "Run `gji go <repo>/<branch>` to switch worktrees.");
		return lines
			.map((line) =>
				line.length > lineWidth ? middleEllipsize(line, lineWidth) : line,
			)
			.join("\n")
			.trimEnd();
	}
	const lines = [
		`GJI  ${data.repositories.length} repositories · ${allWorktrees.length} worktrees${
			attention.length > 0 ? ` · ${attention.length} need attention` : ""
		}`,
		"",
	];

	if (current !== null) {
		lines.push("CURRENT");
		lines.push(
			...formatHubWorktree(current, lineWidth, "@", view.kind === "all"),
		);
		lines.push("");
	}

	if (next !== null && next !== current) {
		lines.push("NEXT");
		lines.push(...formatHubWorktree(next, lineWidth, "›", view.kind === "all"));
		lines.push("");
	}

	if (remainingAttention.length > 0) {
		lines.push("ATTENTION");
		for (const entry of remainingAttention) {
			lines.push(
				...formatHubWorktree(entry, lineWidth, "!", view.kind === "all"),
			);
		}
		lines.push("");
	}

	if (recentOther.length > 0) {
		lines.push("OTHER");
		for (const entry of recentOther) {
			lines.push(
				...formatHubWorktree(entry, lineWidth, " ", view.kind === "all"),
			);
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
			line.length > lineWidth ? middleEllipsize(line, lineWidth) : line,
		)
		.join("\n")
		.trimEnd();
}

function chooseNextWorktree(
	entries: Array<{ repository: HubRepository; worktree: HubWorktree }>,
): { repository: HubRepository; worktree: HubWorktree } | null {
	return (
		[...entries].sort((left, right) => {
			const scoreDifference =
				nextWorktreeScore(right) - nextWorktreeScore(left);
			if (scoreDifference !== 0) return scoreDifference;
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
	if (
		worktree.lastUsedTimestamp !== null &&
		worktree.lastUsedTimestamp !== undefined
	) {
		score += 15;
	}
	return score;
}

function isActionable(
	worktree: HubWorktree,
	reason?: HubAttentionReason,
): boolean {
	if (reason === "dirty") return worktree.status === "dirty";
	if (reason === "behind") {
		return worktree.upstream.kind === "tracked" && worktree.upstream.behind > 0;
	}
	if (reason === "stale") return worktree.upstream.kind === "stale";
	if (reason === "prs") return worktree.pullRequests.length > 0;

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
	includePath = false,
): string[] {
	const { repository, worktree } = entry;
	const branch = worktree.branch ?? "(detached)";
	const status = [
		worktree.status !== "clean" ? worktree.status : null,
		formatUpstreamState(worktree.upstream) !== "up to date"
			? formatUpstreamState(worktree.upstream)
			: null,
		worktree.pullRequests.length > 0
			? worktree.pullRequests
					.map((pullRequest) =>
						pullRequest.title
							? `#${pullRequest.number} ${formatHumanText(pullRequest.title, 60)}`
							: `#${pullRequest.number}`,
					)
					.join(", ")
			: null,
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
	if (includePath) {
		lines.push(`  ${startEllipsize(worktree.path, lineWidth - 2)}`);
	}
	return lines;
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

function middleEllipsize(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	if (maxLength <= 1) return "…";

	const visibleLength = maxLength - 1;
	const startLength = Math.ceil(visibleLength / 2);
	return `${value.slice(0, startLength)}…${value.slice(-Math.floor(visibleLength / 2))}`;
}

function startEllipsize(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	if (maxLength <= 1) return "…";
	return `…${value.slice(-(maxLength - 1))}`;
}

function formatHumanText(value: string, maxLength: number): string {
	const sanitized = Array.from(value, (character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
			? " "
			: character;
	}).join("");
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
