import type { RepoRegistryEntry } from "../../domain/repository/registry.js";
import { mapWithConcurrency } from "../../domain/shared/concurrency.js";
import type { WorktreeSource } from "../../domain/worktree/source.js";
import type {
	RepositoryContextPort,
	RepositoryRegistryPort,
	WorktreePort,
} from "../../ports/repository.js";

const MAX_REPOSITORY_DISCOVERY_CONCURRENCY = 4;

type WorktreeSourceDependencies = RepositoryContextPort &
	RepositoryRegistryPort &
	WorktreePort;

export async function listRegisteredWorktreeSources(
	cwd: string,
	repositoryPort: WorktreeSourceDependencies,
	onSkipped?: (entry: RepoRegistryEntry) => void,
): Promise<WorktreeSource[]> {
	const registry = await repositoryPort.loadRegistry();
	const currentRoot = await repositoryPort
		.detectRepository(cwd)
		.then((repository) => repository.currentRoot)
		.catch(() => null);
	const results = await mapWithConcurrency(
		registry,
		MAX_REPOSITORY_DISCOVERY_CONCURRENCY,
		async (entry) => {
			try {
				const worktrees = await repositoryPort.listWorktrees(entry.path);
				return { entry, worktrees };
			} catch {
				onSkipped?.(entry);
				return null;
			}
		},
	);

	const allItems: WorktreeSource[] = [];
	for (const result of results) {
		if (result === null) continue;
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

	return allItems;
}

export async function listDiscoverableWorktreeSources(
	cwd: string,
	repositoryPort: WorktreeSourceDependencies,
	onSkipped?: (entry: RepoRegistryEntry) => void,
): Promise<WorktreeSource[]> {
	const currentRepository = await repositoryPort
		.detectRepository(cwd)
		.catch(() => null);
	const registeredSources = await listRegisteredWorktreeSources(
		cwd,
		repositoryPort,
		onSkipped,
	);
	if (currentRepository === null) return dedupeSources(registeredSources);

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
