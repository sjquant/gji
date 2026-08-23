import type { RepositoryContext } from "../../domain/repository/context.js";
import {
	resolveExactWorktreeQueryMatches,
	resolveWorktreeQuery,
	resolveWorktreeQueryMatches,
} from "../../domain/worktree/matching.js";
import { parsePrInput } from "../../domain/worktree/pr-reference.js";
import type { WorktreeSource } from "../../domain/worktree/source.js";
import type { ConfigPort } from "../../ports/config.js";
import type {
	RepositoryContextPort,
	RepositoryRefPort,
	RepositoryRegistryPort,
	WorktreePort,
} from "../../ports/repository.js";
import { listRegisteredWorktreeSources } from "./sources.js";

type GoBranchResolutionBase =
	| { kind: "existing"; source: WorktreeSource }
	| { kind: "ambiguous"; matches: WorktreeSource[] }
	| {
			kind: "create";
			repository: RepositoryContext;
			branch: string;
			mode: "checkout" | "track";
			remote?: string;
	  }
	| { kind: "pull-request"; repository: RepositoryContext; input: string }
	| { kind: "no-repository"; staleRegisteredRepos: boolean }
	| { kind: "no-match"; staleRegisteredRepos: boolean }
	| { kind: "error"; message: string };

export type GoBranchResolution = GoBranchResolutionBase & {
	configWarnings?: readonly string[];
};

export async function resolveGoBranch(options: {
	branch: string;
	cwd: string;
	currentSources: WorktreeSource[];
	repository: RepositoryContext | null;
	repositoryPort: RepositoryRefPort;
	sourceDependencies: RepositoryContextPort &
		RepositoryRegistryPort &
		WorktreePort;
	configPort: ConfigPort;
}): Promise<GoBranchResolution> {
	const {
		branch,
		configPort,
		cwd,
		currentSources,
		repository,
		repositoryPort,
		sourceDependencies,
	} = options;
	const pullRequestNumber = parsePrInput(branch);
	const exactCurrentMatches = resolveExistingExactWorktreeMatches(
		currentSources,
		branch,
		false,
	);
	if (exactCurrentMatches.length === 1) {
		return { kind: "existing", source: exactCurrentMatches[0] };
	}

	const localBranch = repository
		? await repositoryPort.hasLocalBranch(repository.repoRoot, branch)
		: false;
	if (!repository && pullRequestNumber !== null) {
		return {
			kind: "error",
			message: "PR references must be resolved from inside a git repository",
		};
	}

	let remote: string | undefined;
	let remoteBranch = false;
	let configError: GoBranchResolution | null = null;
	const configWarnings: string[] = [];
	if (repository) {
		try {
			const config = await configPort.loadEffectiveConfig(
				repository.repoRoot,
				undefined,
				(warning) => configWarnings.push(warning),
			);
			remote = configPort.resolveConfigString(config, "syncRemote") ?? "origin";
			remoteBranch = await repositoryPort.hasRemoteBranch(
				repository.repoRoot,
				remote,
				branch,
			);
		} catch (error) {
			configError = {
				kind: "error",
				message: `could not load repository config: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}
	const pullRequestBelongsToRepository =
		repository && pullRequestNumber !== null
			? await isPullRequestForRepository(
					repository.repoRoot,
					branch,
					repositoryPort,
				)
			: true;
	if (
		pullRequestNumber !== null &&
		!localBranch &&
		!remoteBranch &&
		pullRequestBelongsToRepository
	) {
		const pullRequestMatches = resolveExistingExactWorktreeMatches(
			currentSources,
			branch,
			true,
		);
		if (pullRequestMatches.length === 1) {
			return finish({ kind: "existing", source: pullRequestMatches[0] }, false);
		}
	}

	let skippedRegisteredRepos = 0;
	const registeredSources = await listRegisteredWorktreeSources(
		cwd,
		sourceDependencies,
		() => {
			skippedRegisteredRepos++;
		},
	);
	const crossRepoSources = registeredSources.filter(
		(source) => source.repoRoot !== repository?.repoRoot,
	);
	const crossMatches = await resolveExistingWorktreeMatches(
		crossRepoSources,
		branch,
		(!localBranch && !remoteBranch) || isPullRequestUrl(branch),
		repositoryPort,
	);
	if (crossMatches.length === 1) {
		return finish({ kind: "existing", source: crossMatches[0] }, false);
	}
	if (crossMatches.length > 1) {
		return finish({ kind: "ambiguous", matches: crossMatches }, false);
	}

	if (!repository) {
		return finish(
			registeredSources.length === 0
				? {
						kind: "no-repository",
						staleRegisteredRepos: skippedRegisteredRepos > 0,
					}
				: {
						kind: "no-match",
						staleRegisteredRepos: skippedRegisteredRepos > 0,
					},
		);
	}

	if (localBranch) {
		if (configError) return finish(configError);
		return finish({ kind: "create", repository, branch, mode: "checkout" });
	}
	if (remoteBranch) {
		return finish({
			kind: "create",
			repository,
			branch,
			mode: "track",
			remote,
		});
	}
	const localMatch =
		!pullRequestNumber || !isPullRequestUrl(branch)
			? resolveWorktreeQuery(currentSources, branch)
			: null;
	if (localMatch) {
		return finish({ kind: "existing", source: localMatch });
	}
	if (configError) return finish(configError);

	if (pullRequestNumber !== null && !pullRequestBelongsToRepository) {
		return finish({
			kind: "error",
			message:
				"PR URL does not belong to this repository; run gji go from the matching checkout",
		});
	}

	if (pullRequestNumber !== null) {
		return finish({ kind: "pull-request", repository, input: branch });
	}

	return finish({
		kind: "no-match",
		staleRegisteredRepos: skippedRegisteredRepos > 0,
	});

	function finish(
		resolution: GoBranchResolutionBase,
		includeWarnings = true,
	): GoBranchResolution {
		return !includeWarnings || configWarnings.length === 0
			? resolution
			: { ...resolution, configWarnings };
	}
}

function resolveExistingExactWorktreeMatches(
	sources: WorktreeSource[],
	query: string,
	allowPullRequestFallback: boolean,
): WorktreeSource[] {
	const exactMatches = resolveExactWorktreeQueryMatches(sources, query);
	if (exactMatches.length > 0 || !allowPullRequestFallback) return exactMatches;

	const pullRequestNumber = parsePrInput(query);
	return pullRequestNumber === null
		? []
		: resolveExactWorktreeQueryMatches(sources, `pr/${pullRequestNumber}`);
}

async function resolveExistingWorktreeMatches(
	sources: WorktreeSource[],
	query: string,
	allowPullRequestFallback: boolean,
	repositoryPort: RepositoryRefPort,
): Promise<WorktreeSource[]> {
	const exactMatches = resolveExactWorktreeQueryMatches(sources, query);
	if (exactMatches.length > 0) return exactMatches;

	const pullRequestNumber = parsePrInput(query);
	if (pullRequestNumber === null) {
		return resolveWorktreeQueryMatches(sources, query);
	}
	if (!allowPullRequestFallback) return [];

	const ownershipByRepository = new Map<string, Promise<boolean>>();
	const eligibleSources = await Promise.all(
		sources.map(async (source) => {
			const repoRoot = source.repoRoot ?? source.worktree.path;
			let ownership = ownershipByRepository.get(repoRoot);
			if (ownership === undefined) {
				ownership = isPullRequestForRepository(repoRoot, query, repositoryPort);
				ownershipByRepository.set(repoRoot, ownership);
			}
			return (await ownership) ? source : null;
		}),
	);
	const pullRequestMatches = resolveExactWorktreeQueryMatches(
		eligibleSources.filter(
			(source): source is WorktreeSource => source !== null,
		),
		`pr/${pullRequestNumber}`,
	);
	if (pullRequestMatches.length > 0 || isPullRequestUrl(query)) {
		return pullRequestMatches;
	}

	return resolveWorktreeQueryMatches(sources, query);
}

function isPullRequestUrl(input: string): boolean {
	return /^[a-z][a-z\d+.-]*:\/\//i.test(input);
}

async function isPullRequestForRepository(
	repoRoot: string,
	input: string,
	repositoryPort: RepositoryRefPort,
): Promise<boolean> {
	if (/^\d+$/.test(input) || /^#\d+$/.test(input)) return true;

	let pullRequestUrl: URL;
	try {
		pullRequestUrl = new URL(input);
	} catch {
		return true;
	}

	const remoteUrl = await repositoryPort.getRepositoryRemoteUrl(
		repoRoot,
		"origin",
	);
	if (!remoteUrl) return true;

	return (
		normalizeRepositoryUrl(remoteUrl) ===
		normalizeRepositoryUrl(pullRequestUrl.href)
	);
}

function normalizeRepositoryUrl(value: string): string {
	return normalizeRemoteUrl(value).replace(
		/\/(?:pull|pull-requests|(?:-\/)?merge_requests)\/\d+(?:\/.*)?$/,
		"",
	);
}

function normalizeRemoteUrl(value: string): string {
	const trimmed = value.trim();
	const sshMatch = trimmed.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
	if (sshMatch && !trimmed.includes("://")) {
		return `${sshMatch[1]}/${sshMatch[2]}`
			.replace(/\.git$/, "")
			.replace(/\/$/, "");
	}

	try {
		const url = new URL(trimmed);
		return `${url.host}${url.pathname}`
			.replace(/\.git$/, "")
			.replace(/\/$/, "");
	} catch {
		return trimmed.replace(/\.git$/, "").replace(/\/$/, "");
	}
}
