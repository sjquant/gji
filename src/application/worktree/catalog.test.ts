import { describe, expect, it } from "vitest";
import type { WorktreeSource } from "../../domain/worktree/source.js";
import { loadWorktreeCatalog } from "./catalog.js";
import type { WorktreeInfo } from "./read-models.js";

describe("loadWorktreeCatalog", () => {
	it("joins recent history and branch PR metadata to hydrated worktrees", async () => {
		// Given two worktrees with recent history and pull requests from one repository.
		const sources = [
			createSource("feature/one", "/repo/one"),
			createSource("feature/two", "/repo/two"),
		];

		// When the application loads the full worktree catalog.
		const catalog = await loadWorktreeCatalog(sources, "full", {
			loadHistory: async () => [
				{ path: "/repo/two", timestamp: 200 },
				{ path: "/repo/one", timestamp: 100 },
			],
			readTask: async () => null,
			readWorktreeInfos: async (worktrees) =>
				worktrees.map((worktree) => createInfo(worktree, "clean")),
			queryPullRequests: async (_repoRoot, branch) => [
				{
					number: branch.endsWith("one") ? 1 : 2,
					sourceBranch: branch,
					url: `https://example.test/${branch}`,
				},
			],
		});

		// Then each source keeps its identity and receives matching metadata.
		expect(catalog).toMatchObject([
			{
				lastUsedTimestamp: 100,
				pullRequests: [{ number: 1 }],
				source: { worktree: { path: "/repo/one" } },
			},
			{
				lastUsedTimestamp: 200,
				pullRequests: [{ number: 2 }],
				source: { worktree: { path: "/repo/two" } },
			},
		]);
	});

	it("keeps fast catalogs free of health and PR lookups while retaining tasks", async () => {
		// Given a task-bearing source and lookups that must not run in fast mode.
		const source = createSource("feature/fast", "/repo/fast");
		let healthReads = 0;
		let pullRequestReads = 0;

		// When the application loads the fast catalog.
		const catalog = await loadWorktreeCatalog([source], "fast", {
			loadHistory: async () => [],
			readTask: async () => ({ task: "keep this searchable" }),
			readWorktreeInfos: async () => {
				healthReads += 1;
				return [];
			},
			queryPullRequests: async () => {
				pullRequestReads += 1;
				return [];
			},
		});

		// Then task metadata remains available without expensive metadata queries.
		expect(healthReads).toBe(0);
		expect(pullRequestReads).toBe(0);
		expect(catalog[0]?.info.task).toBe("keep this searchable");
		expect(catalog[0]?.pullRequests).toEqual([]);
	});
});

function createSource(branch: string, path: string): WorktreeSource {
	return {
		repoName: "repo",
		repoRoot: "/repo",
		worktree: { branch, isCurrent: path.endsWith("one"), path },
	};
}

function createInfo(
	worktree: WorktreeSource["worktree"],
	status: WorktreeInfo["status"],
): WorktreeInfo {
	return {
		...worktree,
		lastCommitTimestamp: null,
		slot: null,
		status,
		task: null,
		upstream: { kind: "no-upstream" },
	};
}
