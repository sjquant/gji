import { describe, expect, it } from "vitest";
import type { RepositoryContext } from "../../domain/repository/context.js";
import type { RepoRegistryEntry } from "../../domain/repository/registry.js";
import type { WorktreeEntry } from "../../domain/worktree/types.js";
import {
	listDiscoverableWorktreeSources,
	listRegisteredWorktreeSources,
} from "./sources.js";

describe("worktree source discovery", () => {
	it("returns accessible sources and the registered repositories that were skipped", async () => {
		// Given a registry containing one accessible and one stale repository.
		const accessible = createRegistryEntry("accessible", "/repos/accessible");
		const stale = createRegistryEntry("stale", "/repos/stale");
		const repositoryPort = createRepositoryPort([accessible, stale]);

		// When registered worktree sources are listed.
		const result = await listRegisteredWorktreeSources({
			cwd: accessible.path,
			repositoryPort,
		});

		// Then callers receive both usable sources and structured skip details.
		expect(result.sources).toEqual([
			{
				repoName: accessible.name,
				repoRoot: accessible.path,
				worktree: {
					branch: "feature/accessible",
					isCurrent: false,
					path: "/worktrees/accessible",
				},
			},
		]);
		expect(result.skipped).toEqual([stale]);
	});

	it("adds the current checkout while deduplicating registered sources", async () => {
		// Given a current repository that is also present in the registry.
		const current = createRegistryEntry("current", "/repos/current");
		const repositoryPort = createRepositoryPort([current]);

		// When discoverable worktrees are listed from inside that repository.
		const result = await listDiscoverableWorktreeSources({
			cwd: current.path,
			repositoryPort,
		});

		// Then the current checkout is preferred and duplicate paths appear once.
		expect(result.skipped).toEqual([]);
		expect(result.sources.map((source) => source.worktree.path)).toEqual([
			"/worktrees/current",
		]);
	});
});

function createRegistryEntry(name: string, path: string): RepoRegistryEntry {
	return { lastUsed: 0, name, path };
}

function createRepositoryPort(entries: RepoRegistryEntry[]) {
	const currentRepository: RepositoryContext = {
		currentRoot: "/repos/current",
		isWorktree: false,
		repoName: "current",
		repoRoot: "/repos/current",
	};

	return {
		loadRegistry: async () => entries,
		detectRepository: async (_cwd: string) => currentRepository,
		listWorktrees: async (path: string): Promise<WorktreeEntry[]> => {
			if (path === "/repos/stale") throw new Error("repository unavailable");
			return [
				{
					branch: path.endsWith("current")
						? "feature/current"
						: "feature/accessible",
					isCurrent: false,
					path: path.endsWith("current")
						? "/worktrees/current"
						: "/worktrees/accessible",
				},
			];
		},
	};
}
