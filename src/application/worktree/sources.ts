import type { RepoRegistryEntry } from "../../domain/repository/registry.js";
import { mapWithConcurrency } from "../../domain/shared/concurrency.js";
import type { WorktreeSource } from "../../domain/worktree/source.js";
import type {
	RepositoryContextPort,
	RepositoryRegistryPort,
	WorktreePort,
} from "../../ports/repository.js";

const MAX_REPOSITORY_DISCOVERY_CONCURRENCY = 4;

export type WorktreeSourceDependencies = RepositoryContextPort &
	RepositoryRegistryPort &
	WorktreePort;

export interface WorktreeSourceDiscovery {
	skipped: RepoRegistryEntry[];
	sources: WorktreeSource[];
}

export interface ListWorktreeSourcesOptions {
	cwd: string;
	repositoryPort: WorktreeSourceDependencies;
	signal?: AbortSignal;
}

export async function listRegisteredWorktreeSources(
	options: ListWorktreeSourcesOptions,
): Promise<WorktreeSourceDiscovery> {
	const { cwd, repositoryPort, signal } = options;
	throwIfAborted(signal);
	const registry = await repositoryPort.loadRegistry();
	const currentRoot = await repositoryPort
		.detectRepository(cwd)
		.then((repository) => repository.currentRoot)
		.catch(() => null);
	throwIfAborted(signal);
	const results = await mapWithConcurrency(
		registry,
		MAX_REPOSITORY_DISCOVERY_CONCURRENCY,
		async (entry) => {
			throwIfAborted(signal);
			try {
				const worktrees = await repositoryPort.listWorktrees(entry.path);
				return { entry, skipped: false, worktrees };
			} catch {
				return { entry, skipped: true, worktrees: [] };
			}
		},
		signal,
	);

	const allItems: WorktreeSource[] = [];
	const skipped: RepoRegistryEntry[] = [];
	for (const result of results) {
		if (result.skipped) {
			skipped.push(result.entry);
			continue;
		}
		const { entry, worktrees } = result;
		for (const worktree of worktrees) {
			allItems.push({
				repoRoot: entry.path,
				repoName: entry.name,
				worktree: {
					...worktree,
					isCurrent: currentRoot !== null && worktree.path === currentRoot,
				},
			});
		}
	}

	return { skipped, sources: allItems };
}

export async function listDiscoverableWorktreeSources(
	options: ListWorktreeSourcesOptions,
): Promise<WorktreeSourceDiscovery> {
	const { cwd, repositoryPort } = options;
	const currentRepository = await repositoryPort
		.detectRepository(cwd)
		.catch(() => null);
	const registered = await listRegisteredWorktreeSources(options);
	if (currentRepository === null) {
		return {
			skipped: registered.skipped,
			sources: deduplicateWorktreeSources(registered.sources),
		};
	}

	let currentSources: WorktreeSource[] = [];
	try {
		currentSources = (await repositoryPort.listWorktrees(cwd)).map(
			(worktree) => ({
				repoName: currentRepository.repoName,
				repoRoot: currentRepository.repoRoot,
				worktree,
			}),
		);
	} catch {
		// Registered repositories remain discoverable when the current checkout is transiently unavailable.
	}
	return {
		skipped: registered.skipped,
		sources: deduplicateWorktreeSources([
			...currentSources,
			...registered.sources,
		]),
	};
}

export function deduplicateWorktreeSources(
	sources: WorktreeSource[],
): WorktreeSource[] {
	const seen = new Set<string>();
	return sources.filter((source) => {
		if (seen.has(source.worktree.path)) return false;
		seen.add(source.worktree.path);
		return true;
	});
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new Error("Operation cancelled");
}
