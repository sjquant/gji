import { detectRepository, listWorktrees } from "./repo.js";
import { loadRegistry, type RepoRegistryEntry } from "./repo-registry.js";
import type { WorktreeSource } from "./worktree-source.js";

export async function listRegisteredWorktreeSources(
	cwd: string,
	onSkipped?: (entry: RepoRegistryEntry) => void,
): Promise<WorktreeSource[]> {
	const registry = await loadRegistry();
	const currentRoot = await detectRepository(cwd)
		.then((repository) => repository.currentRoot)
		.catch(() => null);
	const results = await Promise.allSettled(
		registry.map(async (entry) => {
			const worktrees = await listWorktrees(entry.path);
			return { repoName: entry.name, repoRoot: entry.path, worktrees };
		}),
	);

	const allItems: WorktreeSource[] = [];
	for (const [index, result] of results.entries()) {
		if (result.status === "rejected") {
			onSkipped?.(registry[index]);
			continue;
		}
		const { repoName, repoRoot, worktrees } = result.value;
		for (const worktree of worktrees) {
			allItems.push({
				repoRoot,
				repoName,
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

	const currentSources = (await listWorktrees(cwd)).map((worktree) => ({
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
