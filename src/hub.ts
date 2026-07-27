import { basename } from "node:path";

import {
	createPullRequestQuery,
	type PullRequestInfo,
} from "./pull-requests.js";
import { detectRepository } from "./repo.js";
import {
	formatLastCommit,
	formatUpstreamState,
	readWorktreeInfos,
	type WorktreeInfo,
} from "./worktree-info.js";
import type { WorktreeSource } from "./worktree-source.js";
import { listDiscoverableWorktreeSources } from "./worktree-sources.js";

const MAX_HUB_REPOSITORY_CONCURRENCY = 4;

export interface HubCommandOptions {
	cwd: string;
	json?: boolean;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export interface HubCommandDependencies {
	queryRepositoryPullRequests: (repoRoot: string) => Promise<PullRequestInfo[]>;
}

export interface HubWorktree extends WorktreeInfo {
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

	options.stdout(`${formatHubOutput(data, process.stdout.columns ?? 80)}\n`);
	return 0;
}

export function formatHubOutput(
	data: HubData,
	columns = process.stdout.columns ?? 80,
): string {
	if (data.repositories.length === 0) {
		return "No registered repositories. Run gji from a repository to add one.";
	}

	const narrow = columns < 72;
	const lineWidth = Math.max(20, columns);
	const lines = ["GJI REPOSITORY HUB", ""];
	for (const repository of data.repositories) {
		const marker = repository.current ? "*" : " ";
		const prSummary = repository.pullRequests.length
			? ` · ${repository.pullRequests.length} open PR${repository.pullRequests.length === 1 ? "" : "s"}`
			: "";
		lines.push(`${marker} ${repository.name}${prSummary}`);
		lines.push(`  ${startEllipsize(repository.root, lineWidth - 2)}`);
		for (const worktree of repository.worktrees) {
			const branch = worktree.branch ?? "(detached)";
			const prs = worktree.pullRequests
				.map((pullRequest) =>
					pullRequest.title
						? `#${pullRequest.number} ${formatHumanText(pullRequest.title, 80)}`
						: `#${pullRequest.number}`,
				)
				.join(", ");
			const metadata = [
				worktree.status,
				formatUpstreamState(worktree.upstream),
				formatLastCommit(worktree.lastCommitTimestamp),
				worktree.task === null ? null : formatHumanText(worktree.task, 80),
				prs,
			]
				.filter((value): value is string => value !== null && value.length > 0)
				.join(" · ");
			const worktreeMarker = worktree.isCurrent ? "*" : " ";
			lines.push(
				`  ${worktreeMarker} ${middleEllipsize(branch, lineWidth - 6)}`,
			);
			if (metadata.length > 0) {
				lines.push(
					`    ${narrow ? middleEllipsize(metadata, lineWidth - 4) : metadata}`,
				);
			}
			lines.push(`    ${startEllipsize(worktree.path, lineWidth - 4)}`);
		}
		lines.push("");
	}

	return lines.join("\n").trimEnd();
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
