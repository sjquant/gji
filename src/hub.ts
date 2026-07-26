import { basename } from "node:path";

import {
	createPullRequestQuery,
	type PullRequestInfo,
} from "./pull-requests.js";
import { detectRepository, listWorktrees, type WorktreeEntry } from "./repo.js";
import {
	formatLastCommit,
	formatUpstreamState,
	readWorktreeInfos,
	type WorktreeInfo,
} from "./worktree-info.js";
import type { WorktreeSource } from "./worktree-source.js";
import { listRegisteredWorktreeSources } from "./worktree-sources.js";

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
	const registeredSources = await listRegisteredWorktreeSources(cwd);
	const sources = await mergeCurrentSources(
		cwd,
		currentRepository,
		registeredSources,
	);
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

	const repositories = await Promise.all(
		[...groups.entries()].map(async ([root, group]) => {
			const infos = await readWorktreeInfos(
				dedupeWorktrees(group.sources.map((source) => source.worktree)),
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
		}),
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

	options.stdout(`${formatHubOutput(data)}\n`);
	return 0;
}

export function formatHubOutput(data: HubData): string {
	if (data.repositories.length === 0) {
		return "No registered repositories. Run gji from a repository to add one.";
	}

	const lines = ["GJI REPOSITORY HUB", ""];
	for (const repository of data.repositories) {
		const marker = repository.current ? "*" : " ";
		const prSummary = repository.pullRequests.length
			? ` · ${repository.pullRequests.length} open PR${repository.pullRequests.length === 1 ? "" : "s"}`
			: "";
		lines.push(`${marker} ${repository.name}${prSummary}`);
		lines.push(`  ${repository.root}`);
		for (const worktree of repository.worktrees) {
			const branch = worktree.branch ?? "(detached)";
			const prs = worktree.pullRequests
				.map((pullRequest) =>
					pullRequest.title
						? `#${pullRequest.number} ${pullRequest.title}`
						: `#${pullRequest.number}`,
				)
				.join(", ");
			const metadata = [
				worktree.status,
				formatUpstreamState(worktree.upstream),
				formatLastCommit(worktree.lastCommitTimestamp),
				worktree.task,
				prs,
			]
				.filter((value): value is string => value !== null && value.length > 0)
				.join(" · ");
			lines.push(`  ${worktree.isCurrent ? "*" : " "} ${branch} — ${metadata}`);
			lines.push(`      ${worktree.path}`);
		}
		lines.push("");
	}

	return lines.join("\n").trimEnd();
}

async function mergeCurrentSources(
	cwd: string,
	currentRepository: Awaited<ReturnType<typeof detectRepository>> | null,
	registeredSources: WorktreeSource[],
): Promise<WorktreeSource[]> {
	if (!currentRepository) return dedupeSources(registeredSources);

	const currentWorktrees = await listWorktrees(cwd);
	const currentSources = currentWorktrees.map((worktree) => ({
		repoName: currentRepository.repoName,
		repoRoot: currentRepository.repoRoot,
		worktree,
	}));
	return dedupeSources([...currentSources, ...registeredSources]);
}

function dedupeSources(sources: WorktreeSource[]): WorktreeSource[] {
	const seen = new Set<string>();
	return sources.filter((source) => {
		if (seen.has(source.worktree.path)) return false;
		seen.add(source.worktree.path);
		return true;
	});
}

function dedupeWorktrees(worktrees: WorktreeEntry[]): WorktreeEntry[] {
	const seen = new Set<string>();
	return worktrees.filter((worktree) => {
		if (seen.has(worktree.path)) return false;
		seen.add(worktree.path);
		return true;
	});
}
