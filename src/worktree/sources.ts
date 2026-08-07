import { detectRepository, listWorktrees } from "../repo.js";
import { loadRegistry, type RepoRegistryEntry } from "../repo-registry.js";
import type { WorktreeSource } from "./source.js";

const MAX_REPOSITORY_DISCOVERY_CONCURRENCY = 4;

export async function listRegisteredWorktreeSources(
	cwd: string,
	onSkipped?: (entry: RepoRegistryEntry) => void,
): Promise<WorktreeSource[]> {
	const registry = await loadRegistry();
	const currentRoot = await detectRepository(cwd)
		.then((repository) => repository.currentRoot)
		.catch(() => null);
	const results = await mapWithConcurrency(
		registry,
		MAX_REPOSITORY_DISCOVERY_CONCURRENCY,
		async (entry) => {
			try {
				const worktrees = await listWorktrees(entry.path);
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
	onSkipped?: (entry: RepoRegistryEntry) => void,
): Promise<WorktreeSource[]> {
	const currentRepository = await detectRepository(cwd).catch(() => null);
	const registeredSources = await listRegisteredWorktreeSources(cwd, onSkipped);
	if (currentRepository === null) return dedupeSources(registeredSources);

	let currentSources: WorktreeSource[] = [];
	try {
		currentSources = (await listWorktrees(cwd)).map((worktree) => ({
			repoName: currentRepository.repoName,
			repoRoot: currentRepository.repoRoot,
			worktree,
		}));
	} catch {
		// Registered repositories remain discoverable when the current checkout is transiently unavailable.
	}
	return dedupeSources([...currentSources, ...registeredSources]);
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

function dedupeSources(sources: WorktreeSource[]): WorktreeSource[] {
	const seen = new Set<string>();
	return sources.filter((source) => {
		if (seen.has(source.worktree.path)) return false;
		seen.add(source.worktree.path);
		return true;
	});
}
