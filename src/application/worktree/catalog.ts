import type { RepositoryContext } from "../../domain/repository/context.js";
import type { WorktreeSource } from "../../domain/worktree/source.js";
import type {
	WorktreeEntry,
	WorktreeInfo,
} from "../../domain/worktree/types.js";
import type { PullRequestInfo } from "../../ports/pull-requests.js";
import type {
	RepositoryContextPort,
	WorktreePort,
} from "../../ports/repository.js";

export interface LinkedWorktreeContext {
	linkedWorktrees: WorktreeEntry[];
	repository: RepositoryContext;
}

export type WorktreeMetadataMode = "full" | "fast";

export interface HydratedWorktree {
	info: WorktreeInfo;
	lastUsedTimestamp: number | null;
	pullRequests: PullRequestInfo[];
	source: WorktreeSource;
}

export interface WorktreeCatalogDependencies {
	loadHistory: () => Promise<
		ReadonlyArray<{ path: string; timestamp: number }>
	>;
	readTask: (worktreePath: string) => Promise<{ task: string } | null>;
	readWorktreeInfos: (worktrees: WorktreeEntry[]) => Promise<WorktreeInfo[]>;
	queryPullRequests?: (
		repoRoot: string,
		sourceBranch: string,
	) => Promise<PullRequestInfo[]>;
	queryRepositoryPullRequests?: (
		repoRoot: string,
	) => Promise<PullRequestInfo[]>;
}

const MAX_PULL_REQUEST_REPOSITORY_QUERY_CONCURRENCY = 4;
const MAX_TASK_READ_CONCURRENCY = 8;

export async function loadWorktreeCatalog(
	sources: WorktreeSource[],
	metadata: WorktreeMetadataMode,
	dependencies: WorktreeCatalogDependencies,
): Promise<HydratedWorktree[]> {
	const includeMetadata = metadata === "full";
	const repositoryPullRequests =
		includeMetadata && dependencies.queryRepositoryPullRequests !== undefined
			? readRepositoryPullRequests(
					sources,
					dependencies.queryRepositoryPullRequests,
				)
			: Promise.resolve(null);
	const [history, infos, pullRequestsByRepository] = await Promise.all([
		dependencies.loadHistory(),
		includeMetadata
			? dependencies.readWorktreeInfos(sources.map((source) => source.worktree))
			: mapWithConcurrency(sources, MAX_TASK_READ_CONCURRENCY, async (source) =>
					createUnhydratedWorktreeInfo(source.worktree, dependencies.readTask),
				),
		repositoryPullRequests,
	]);
	const pullRequests = includeMetadata
		? await Promise.all(
				sources.map((source) =>
					readSourcePullRequests(
						source,
						dependencies.queryPullRequests,
						pullRequestsByRepository,
					),
				),
			)
		: sources.map(() => []);
	const historyByPath = new Map(history.map((entry) => [entry.path, entry]));

	return sources.map((source, index) => ({
		info: infos[index],
		lastUsedTimestamp:
			historyByPath.get(source.worktree.path)?.timestamp ?? null,
		pullRequests: pullRequests[index],
		source,
	}));
}

export async function loadLinkedWorktrees(
	cwd: string,
	repositoryPort: RepositoryContextPort & WorktreePort,
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

async function createUnhydratedWorktreeInfo(
	worktree: WorktreeEntry,
	readTask: WorktreeCatalogDependencies["readTask"],
): Promise<WorktreeInfo> {
	let task: string | null = null;
	try {
		task = (await readTask(worktree.path))?.task ?? null;
	} catch {
		// Task metadata is optional picker decoration.
	}

	return {
		...worktree,
		lastCommitTimestamp: null,
		slot: null,
		status: "unknown",
		task,
		upstream: { kind: "unknown" },
	};
}

async function readSourcePullRequests(
	source: WorktreeSource,
	queryPullRequests: WorktreeCatalogDependencies["queryPullRequests"],
	pullRequestsByRepository: Map<string, PullRequestInfo[]> | null,
): Promise<PullRequestInfo[]> {
	if (source.repoRoot === undefined || source.worktree.branch === null) {
		return [];
	}

	if (pullRequestsByRepository !== null) {
		return sortPullRequests(
			pullRequestsByRepository
				.get(source.repoRoot)
				?.filter(
					(pullRequest) => pullRequest.sourceBranch === source.worktree.branch,
				),
		);
	}

	if (queryPullRequests === undefined) return [];
	try {
		return sortPullRequests(
			await queryPullRequests(source.repoRoot, source.worktree.branch),
		);
	} catch {
		return [];
	}
}

async function readRepositoryPullRequests(
	sources: WorktreeSource[],
	queryPullRequests: NonNullable<
		WorktreeCatalogDependencies["queryRepositoryPullRequests"]
	>,
): Promise<Map<string, PullRequestInfo[]>> {
	const repoRoots = [
		...new Set(
			sources.flatMap((source) =>
				source.repoRoot === undefined || source.worktree.branch === null
					? []
					: [source.repoRoot],
			),
		),
	];
	const results = await mapWithConcurrency(
		repoRoots,
		MAX_PULL_REQUEST_REPOSITORY_QUERY_CONCURRENCY,
		async (repoRoot): Promise<[string, PullRequestInfo[]]> => {
			try {
				return [repoRoot, sortPullRequests(await queryPullRequests(repoRoot))];
			} catch {
				return [repoRoot, []];
			}
		},
	);

	return new Map(results);
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

function sortPullRequests(
	pullRequests: PullRequestInfo[] | undefined,
): PullRequestInfo[] {
	return [...(pullRequests ?? [])].sort(
		(left, right) => left.number - right.number,
	);
}
