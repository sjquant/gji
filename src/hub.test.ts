import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { formatHubOutput, type HubData } from "./hub.js";
import { addLinkedWorktree, createRepository } from "./repo.test-helpers.js";
import { loadRegistry } from "./repo-registry.js";
import { writeTask } from "./task.js";

describe("repository hub", () => {
	it("shows the current repository, worktree context, and PR titles", async () => {
		// Given a repository with a task and an open PR returned by the discovery adapter.
		const repoRoot = await createRepository();
		const linkedPath = await addLinkedWorktree(repoRoot, "feature/hub");
		await writeTask(linkedPath, "polish the dashboard discovery flow");
		const stdout: string[] = [];

		// When the bare CLI is run from the repository.
		const result = await runCli([], {
			cwd: repoRoot,
			hubDependencies: {
				queryRepositoryPullRequests: async () => [
					{
						number: 42,
						sourceBranch: "feature/hub",
						title: "Add dashboard\n\u001b[31mdiscovery",
						url: "https://example.test/pull/42",
					},
				],
			},
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the hub exposes enough context to choose the next repository or worktree.
		expect(result.exitCode).toBe(0);
		const output = stdout.join("");
		expect(output).toContain("GJI  1 repositories");
		expect(output).toContain("feature/hub");
		expect(output).toContain("polish the dashboard discovery flow");
		expect(output).toContain("#42 Add dashboard");
		expect(output).not.toContain("\u001b");
	});

	it("registers the current repository for both human and JSON hub access", async () => {
		// Given a repository and an isolated registry.
		const repoRoot = await createRepository();
		const configDir = await mkdtemp(join(tmpdir(), "gji-hub-config-"));
		const previousConfigDir = process.env.GJI_CONFIG_DIR;
		process.env.GJI_CONFIG_DIR = configDir;

		try {
			// When each hub mode is invoked from the repository.
			await runCli([], { cwd: repoRoot, stdout: () => undefined });
			await runCli(["--json"], { cwd: repoRoot, stdout: () => undefined });

			// Then both modes leave the repository available to future discovery.
			expect(await loadRegistry()).toEqual([
				expect.objectContaining({ path: repoRoot }),
			]);
		} finally {
			if (previousConfigDir === undefined) delete process.env.GJI_CONFIG_DIR;
			else process.env.GJI_CONFIG_DIR = previousConfigDir;
		}
	});

	it("emits a stable dashboard-oriented JSON projection", async () => {
		// Given a repository with one current worktree.
		const repoRoot = await createRepository();
		const stdout: string[] = [];

		// When the bare CLI is run in JSON mode.
		const result = await runCli(["--json"], {
			cwd: repoRoot,
			hubDependencies: {
				queryRepositoryPullRequests: async () => [],
			},
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then consumers receive repository and worktree data without parsing table output.
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(stdout.join(""))).toMatchObject({
			currentRepository: repoRoot,
			repositories: [
				{
					current: true,
					root: repoRoot,
					worktrees: [{ path: repoRoot, isCurrent: true }],
				},
			],
		});
	});

	it("keeps narrow hub output readable without soft-wrapping rows", () => {
		// Given a repository with long worktree context.
		const data: HubData = {
			currentRepository: "/Users/me/projects/gji",
			repositories: [
				{
					current: true,
					name: "gji",
					pullRequests: [],
					root: "/Users/me/projects/gji",
					worktrees: [
						{
							branch: "feature/a-very-long-branch-name",
							isCurrent: true,
							lastCommitTimestamp: null,
							path: "/Users/me/.gji/worktrees/feature-a-very-long-name",
							pullRequests: [],
							slot: 1,
							status: "clean",
							task: "review the repository discovery experience",
							upstream: { kind: "tracked", ahead: 0, behind: 2 },
						},
					],
				},
			],
		};

		// When the hub is formatted for a narrow terminal.
		const output = formatHubOutput(data, fortyTwo);

		// Then every row fits and metadata has its own readable line.
		const rows = output.split("\n");
		expect(Math.max(...rows.map((row) => row.length))).toBeLessThanOrEqual(
			fortyTwo,
		);
		expect(output).toContain("› gji/feature/");
		expect(output).toContain("behind 2");
		expect(output).toContain("…");
	});

	it("prioritizes a next worktree and collapses quiet worktrees", () => {
		// Given one active task, one dirty worktree, and several quiet worktrees.
		const quietWorktrees = Array.from({ length: 6 }, (_, index) => ({
			branch: `quiet/${index}`,
			isCurrent: false,
			lastCommitTimestamp: index,
			path: `/repo/quiet-${index}`,
			pullRequests: [],
			slot: index + 2,
			status: "clean" as const,
			task: null,
			upstream: { kind: "tracked" as const, ahead: 0, behind: 0 },
		}));
		const data: HubData = {
			currentRepository: "/repo",
			repositories: [
				{
					current: true,
					name: "repo",
					pullRequests: [],
					root: "/repo",
					worktrees: [
						{
							branch: "feature/task",
							isCurrent: true,
							lastCommitTimestamp: 10,
							path: "/repo/task",
							pullRequests: [],
							slot: 0,
							status: "clean",
							task: "finish the dashboard",
							upstream: { kind: "no-upstream" },
						},
						{
							branch: "feature/dirty",
							isCurrent: false,
							lastCommitTimestamp: 20,
							path: "/repo/dirty",
							pullRequests: [],
							slot: 1,
							status: "dirty",
							task: null,
							upstream: { kind: "no-upstream" },
						},
						...quietWorktrees,
					],
				},
			],
		};

		// When the action-oriented hub is formatted.
		const output = formatHubOutput(data, 80);

		// Then the task is the recommendation, attention is separate, and quiet items collapse.
		expect(output.indexOf("NEXT")).toBeLessThan(output.indexOf("feature/task"));
		expect(output).toContain("next: gji go repo/feature/task");
		expect(output).toContain("ATTENTION");
		expect(output).toContain("repo/feature/dirty");
		expect(output).toContain("1 quiet worktree hidden");
	});
});

const fortyTwo = 42;
