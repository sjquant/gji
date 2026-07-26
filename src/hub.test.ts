import { describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { addLinkedWorktree, createRepository } from "./repo.test-helpers.js";
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
						title: "Add dashboard discovery",
						url: "https://example.test/pull/42",
					},
				],
			},
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the hub exposes enough context to choose the next repository or worktree.
		expect(result.exitCode).toBe(0);
		const output = stdout.join("");
		expect(output).toContain("GJI REPOSITORY HUB");
		expect(output).toContain("feature/hub");
		expect(output).toContain("polish the dashboard discovery flow");
		expect(output).toContain("#42 Add dashboard discovery");
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
});
