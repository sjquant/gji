import { describe, expect, it, vi } from "vitest";

import {
	createPullRequestQuery,
	type PullRequestCommandRunner,
	parsePullRequestRemote,
} from "./pull-requests.js";

describe("pull request remote parsing", () => {
	it("parses supported HTTPS and SSH forge remotes", () => {
		// Given supported GitHub, GitLab, and Bitbucket remote URL forms.
		const remotes = [
			[
				"git@github.com:octo/widgets.git",
				{ forge: "github", namespace: "octo", repository: "widgets" },
			],
			[
				"https://gitlab.example.com/platform/team/widgets.git",
				{
					forge: "gitlab",
					namespace: "platform/team",
					repository: "widgets",
				},
			],
			[
				"ssh://git@bitbucket.org/team/widgets.git",
				{ forge: "bitbucket", namespace: "team", repository: "widgets" },
			],
		] as const;

		// When each remote is parsed.
		const parsed = remotes.map(([remote]) => parsePullRequestRemote(remote));

		// Then the forge and repository coordinates are preserved.
		expect(parsed).toEqual(
			remotes.map(([, expected]) => expect.objectContaining(expected)),
		);
	});

	it("rejects unsupported remotes", () => {
		// Given a remote that does not identify a supported forge.
		// When the remote is parsed.
		const parsed = parsePullRequestRemote(
			"https://example.com/team/widgets.git",
		);

		// Then the selector has no PR provider to query.
		expect(parsed).toBeNull();
	});
});

describe("pull request lookup", () => {
	it("prefers the authenticated provider CLI and sorts open PRs by number", async () => {
		// Given a GitHub remote and a provider CLI returning multiple open PRs.
		const calls: string[][] = [];
		const timeouts: number[] = [];
		const fetcher = vi.fn<typeof fetch>();
		const runCommand: PullRequestCommandRunner = async (
			command,
			args,
			options,
		) => {
			calls.push([command, ...args]);
			timeouts.push(options.timeout);
			if (command === "git") {
				return { stdout: "git@github.com:octo/widgets.git\n" };
			}
			return {
				stdout: JSON.stringify([
					{
						headRefName: "feature/search",
						number: 34,
						state: "OPEN",
						url: "https://github.com/octo/widgets/pull/34",
					},
					{
						headRefName: "feature/search",
						number: 12,
						state: "OPEN",
						url: "https://github.com/octo/widgets/pull/12",
					},
				]),
			};
		};

		// When open PRs are looked up for the source branch.
		const pullRequests = await createPullRequestQuery({
			fetch: fetcher,
			runCommand,
		}).listOpenPullRequests("/repo", "feature/search");

		// Then the CLI result is used without an API request and sorted numerically.
		expect(fetcher).not.toHaveBeenCalled();
		expect(calls[1]).toContain("--head");
		expect(timeouts).toEqual([2500, 2500]);
		expect(pullRequests.map((pullRequest) => pullRequest.number)).toEqual([
			12, 34,
		]);
	});

	it("falls back to the public API after a CLI failure", async () => {
		// Given a GitLab remote whose provider CLI is unavailable or unauthenticated.
		const runCommand: PullRequestCommandRunner = async (command) => {
			if (command === "git") {
				return { stdout: "https://gitlab.com/platform/widgets.git" };
			}
			throw new Error("glab is not authenticated");
		};
		const fetcher = vi.fn<typeof fetch>(
			async () =>
				new Response(
					JSON.stringify([
						{
							iid: 7,
							state: "opened",
							source_branch: "feature/api",
							web_url: "https://gitlab.com/platform/widgets/-/merge_requests/7",
						},
					]),
					{ status: 200 },
				),
		);

		// When the source branch is queried.
		const pullRequests = await createPullRequestQuery({
			fetch: fetcher,
			runCommand,
		}).listOpenPullRequests("/repo", "feature/api");

		// Then the public API result is returned.
		expect(fetcher).toHaveBeenCalledWith(
			expect.stringContaining("source_branch=feature%2Fapi"),
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(pullRequests).toEqual([
			{
				number: 7,
				sourceBranch: "feature/api",
				url: "https://gitlab.com/platform/widgets/-/merge_requests/7",
			},
		]);
	});

	it("reports a lookup failure after CLI and API authentication failures", async () => {
		// Given a private Bitbucket remote and failures at both external boundaries.
		const runCommand: PullRequestCommandRunner = async (command) => {
			if (command === "git") {
				return { stdout: "git@bitbucket.org:team/widgets.git" };
			}
			throw new Error("provider CLI failed");
		};
		const fetcher = vi.fn<typeof fetch>(
			async () => new Response("unauthorized", { status: 401 }),
		);

		// When open PR lookup is attempted.
		const lookup = createPullRequestQuery({ fetch: fetcher, runCommand });

		// Then the explicit command boundary can report the failure.
		await expect(
			lookup.listOpenPullRequests("/repo", "feature/private"),
		).rejects.toThrow("HTTP 401");
	});
});
