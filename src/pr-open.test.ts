import { afterEach, describe, expect, it } from "vitest";

import { createPrOpenCommand } from "./pr-open.js";
import type { PullRequestInfo } from "./pull-requests.js";
import { addLinkedWorktree, createRepository } from "./repo.test-helpers.js";

afterEach(() => {
	delete process.env.GJI_NO_TUI;
});

describe("gji pr open", () => {
	it("opens the current worktree PR without showing a selector", async () => {
		// Given a current linked worktree with one open PR.
		const repoRoot = await createRepository();
		const branch = "feature/current-pr";
		const currentPath = await addLinkedWorktree(repoRoot, branch);
		const queriedBranches: string[] = [];
		const opened: string[] = [];
		const runPrOpen = createPrOpenCommand({
			openBrowser: async (url) => {
				opened.push(url);
			},
			queryPullRequests: async (_root, sourceBranch) => {
				queriedBranches.push(sourceBranch);
				return [
					{
						number: 7,
						sourceBranch,
						url: "https://github.com/example/repo/pull/7",
					},
				];
			},
		});

		// When pr open runs without a target from the current worktree.
		const result = await runPrOpen({
			cwd: currentPath,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then the current branch is queried and its only PR opens immediately.
		expect(result).toBe(0);
		expect(queriedBranches).toEqual([branch]);
		expect(opened).toEqual(["https://github.com/example/repo/pull/7"]);
	});

	it("gives headless users an explicit target when the current worktree has no PR", async () => {
		// Given headless mode and no open PR for the current worktree.
		process.env.GJI_NO_TUI = "1";
		const repoRoot = await createRepository();
		const errors: string[] = [];
		const runPrOpen = createPrOpenCommand({
			queryPullRequests: async () => [],
		});

		// When pr open runs without a target.
		const result = await runPrOpen({
			cwd: repoRoot,
			stderr: (chunk) => errors.push(chunk),
			stdout: () => undefined,
		});

		// Then the error points to an explicit branch or PR number instead of a selector.
		expect(result).toBe(1);
		expect(errors.join("")).toContain("explicit branch or PR number");
		expect(errors.join("")).not.toContain("--select");
	});

	it("shows only worktrees with open PRs in the explicit selector", async () => {
		// Given a repository with one PR-connected worktree and one unrelated worktree.
		const repoRoot = await createRepository();
		const connectedBranch = "feature/connected";
		const connectedPath = await addLinkedWorktree(repoRoot, connectedBranch);
		await addLinkedWorktree(repoRoot, "feature/unrelated");
		const selectedEntries: string[] = [];
		const opened: string[] = [];
		const runPrOpen = createPrOpenCommand({
			openBrowser: async (url) => {
				opened.push(url);
			},
			promptForWorktree: async (entries) => {
				selectedEntries.push(...entries.map((entry) => entry.branch ?? ""));
				return connectedPath;
			},
			queryPullRequests: async (_root, branch) =>
				branch === connectedBranch
					? [
							{
								number: 12,
								sourceBranch: branch,
								url: "https://github.com/example/repo/pull/12",
							},
						]
					: [],
		});

		// When pr open runs with the explicit selector flag.
		const result = await runPrOpen({
			cwd: repoRoot,
			stderr: () => undefined,
			select: true,
			stdout: () => undefined,
		});

		// Then only the connected branch is offered and its URL is opened.
		expect(result).toBe(0);
		expect(selectedEntries).toEqual([connectedBranch]);
		expect(opened).toEqual(["https://github.com/example/repo/pull/12"]);
	});

	it("hydrates worktree health only after repository PR filtering", async () => {
		// Given one PR-connected worktree and one unrelated worktree.
		const repoRoot = await createRepository();
		const connectedBranch = "feature/connected-first";
		const connectedPath = await addLinkedWorktree(repoRoot, connectedBranch);
		await addLinkedWorktree(repoRoot, "feature/unrelated-second");
		const promptedBranches: string[] = [];
		let branchQueryCount = 0;
		const runPrOpen = createPrOpenCommand({
			openBrowser: async () => undefined,
			promptForWorktree: async (entries) => {
				promptedBranches.push(...entries.map((entry) => entry.branch ?? ""));
				return connectedPath;
			},
			queryPullRequests: async () => {
				branchQueryCount += 1;
				return [];
			},
			queryRepositoryPullRequests: async (_root) => [
				{
					number: 21,
					sourceBranch: connectedBranch,
					url: "https://github.com/example/repo/pull/21",
				},
			],
		});

		// When the explicit PR worktree selector opens.
		const result = await runPrOpen({
			cwd: repoRoot,
			select: true,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then only the connected entry is hydrated and no branch lookup is repeated.
		expect(result).toBe(0);
		expect(promptedBranches).toEqual([connectedBranch]);
		expect(branchQueryCount).toBe(0);
	});

	it("uses the existing exact and partial branch matching rules", async () => {
		// Given a linked worktree whose branch contains the requested fragment.
		const repoRoot = await createRepository();
		const branch = "feature/branch-search";
		await addLinkedWorktree(repoRoot, branch);
		const queriedBranches: string[] = [];
		const opened: string[] = [];
		const runPrOpen = createPrOpenCommand({
			openBrowser: async (url) => {
				opened.push(url);
			},
			queryPullRequests: async (_root, sourceBranch) => {
				queriedBranches.push(sourceBranch);
				return [
					{
						number: 18,
						sourceBranch,
						url: "https://gitlab.com/example/repo/-/merge_requests/18",
					},
				];
			},
		});

		// When pr open receives a partial branch query.
		const result = await runPrOpen({
			cwd: repoRoot,
			target: "branch-search",
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then the matching worktree branch is queried and opened.
		expect(result).toBe(0);
		expect(queriedBranches).toContain(branch);
		expect(opened).toEqual([
			"https://gitlab.com/example/repo/-/merge_requests/18",
		]);
	});

	it("opens a PR by number even when no local worktree exists", async () => {
		// Given a direct open-PR lookup that returns a hosted URL.
		const repoRoot = await createRepository();
		const opened: string[] = [];
		const runPrOpen = createPrOpenCommand({
			findOpenPullRequest: async (_root, number) => ({
				number,
				sourceBranch: "feature/remote-only",
				url: `https://bitbucket.org/example/repo/pull-requests/${number}`,
			}),
			openBrowser: async (url) => {
				opened.push(url);
			},
		});

		// When pr open receives a numeric target.
		const result = await runPrOpen({
			cwd: repoRoot,
			target: "#41",
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then it opens the hosted PR without requiring a local branch.
		expect(result).toBe(0);
		expect(opened).toEqual([
			"https://bitbucket.org/example/repo/pull-requests/41",
		]);
	});

	it("prompts for a second selection when a worktree has multiple PRs", async () => {
		// Given one worktree with two open PRs on the same source branch.
		const repoRoot = await createRepository();
		const branch = "feature/multiple-prs";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		let promptedPullRequests: PullRequestInfo[] = [];
		const opened: string[] = [];
		const runPrOpen = createPrOpenCommand({
			openBrowser: async (url) => {
				opened.push(url);
			},
			promptForPullRequest: async (pullRequests) => {
				promptedPullRequests = pullRequests;
				return pullRequests[1];
			},
			promptForWorktree: async () => worktreePath,
			queryPullRequests: async (_root, sourceBranch) => [
				{
					number: 34,
					sourceBranch,
					url: "https://github.com/example/repo/pull/34",
				},
				{
					number: 12,
					sourceBranch,
					url: "https://github.com/example/repo/pull/12",
				},
			],
		});

		// When pr open runs through the explicit worktree selector.
		const result = await runPrOpen({
			cwd: repoRoot,
			stderr: () => undefined,
			select: true,
			stdout: () => undefined,
		});

		// Then PRs are presented in numeric order and the second choice is opened.
		expect(result).toBe(0);
		expect(
			promptedPullRequests.map((pullRequest) => pullRequest.number),
		).toEqual([12, 34]);
		expect(opened).toEqual(["https://github.com/example/repo/pull/34"]);
	});

	it("returns a clear error when browser launch fails", async () => {
		// Given a PR URL and a browser boundary that rejects.
		const repoRoot = await createRepository();
		const errors: string[] = [];
		const runPrOpen = createPrOpenCommand({
			findOpenPullRequest: async () => ({
				number: 9,
				sourceBranch: "feature/browser",
				url: "https://github.com/example/repo/pull/9",
			}),
			openBrowser: async () => {
				throw new Error("browser unavailable");
			},
		});

		// When pr open attempts to launch the browser.
		const result = await runPrOpen({
			cwd: repoRoot,
			target: "9",
			stderr: (chunk) => errors.push(chunk),
			stdout: () => undefined,
		});

		// Then it exits 1 and explains the external boundary failure.
		expect(result).toBe(1);
		expect(errors.join("")).toContain("failed to open PR #9");
		expect(errors.join("")).toContain("browser unavailable");
	});

	it("rejects the selector flag in headless mode", async () => {
		// Given headless mode and an explicit selector request.
		process.env.GJI_NO_TUI = "1";
		const errors: string[] = [];
		const runPrOpen = createPrOpenCommand();

		// When pr open is invoked with --select.
		const result = await runPrOpen({
			cwd: "/not-a-repository",
			stderr: (chunk) => errors.push(chunk),
			select: true,
			stdout: () => undefined,
		});

		// Then it rejects the interactive-only selector before repository lookup.
		expect(result).toBe(1);
		expect(errors.join("")).toContain("selector is unavailable");
	});

	it("rejects PR selection in headless mode when the current branch has multiple PRs", async () => {
		// Given headless mode and multiple open PRs for the current worktree.
		process.env.GJI_NO_TUI = "1";
		const repoRoot = await createRepository();
		const errors: string[] = [];
		let prompted = false;
		const runPrOpen = createPrOpenCommand({
			promptForPullRequest: async () => {
				prompted = true;
				return null;
			},
			queryPullRequests: async (_root, sourceBranch) => [
				{
					number: 12,
					sourceBranch,
					url: "https://github.com/example/repo/pull/12",
				},
				{
					number: 34,
					sourceBranch,
					url: "https://github.com/example/repo/pull/34",
				},
			],
		});

		// When pr open runs without a target in the current worktree.
		const result = await runPrOpen({
			cwd: repoRoot,
			stderr: (chunk) => errors.push(chunk),
			stdout: () => undefined,
		});

		// Then it fails without entering an interactive prompt.
		expect(result).toBe(1);
		expect(prompted).toBe(false);
		expect(errors.join("")).toContain("multiple open PRs found");
	});
});
