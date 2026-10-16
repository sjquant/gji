import { describe, expect, it } from "vitest";
import { createWorktreePathFilter } from "./path-filter.js";

describe("worktree path filter", () => {
	it("matches a directory and its descendants", () => {
		// Given a directory pattern.
		const matches = createWorktreePathFilter(["/repos/worktrees/gji"]);

		// When paths inside, equal to, and beside the directory are checked.
		// Then only the directory and its descendants match.
		expect(matches("/repos/worktrees/gji")).toBe(true);
		expect(matches("/repos/worktrees/gji/a/b")).toBe(true);
		expect(matches("/repos/worktrees/gji-other")).toBe(false);
	});

	it("keeps single-star globs within one path segment", () => {
		// Given a single-star glob.
		const matches = createWorktreePathFilter([
			"/repos/worktrees/gji/feature-*",
		]);

		// When paths in and below the matching segment are checked.
		// Then only the same-segment path matches.
		expect(matches("/repos/worktrees/gji/feature-a")).toBe(true);
		expect(matches("/repos/worktrees/gji/feature-a/nested")).toBe(false);
	});

	it("lets double-star globs span path segments", () => {
		// Given a double-star glob.
		const matches = createWorktreePathFilter(["/repos/**/spike"]);

		// When paths at different depths are checked.
		// Then any depth matches, including zero intermediate segments.
		expect(matches("/repos/spike")).toBe(true);
		expect(matches("/repos/worktrees/gji/spike")).toBe(true);
		expect(matches("/repos/worktrees/gji/spiked")).toBe(false);
	});

	it("treats regex metacharacters literally and ? as one character", () => {
		// Given a glob containing regex metacharacters.
		const matches = createWorktreePathFilter(["/repos/fix.(v?)"]);

		// When literal and lookalike paths are checked.
		// Then only literal matches pass.
		expect(matches("/repos/fix.(v2)")).toBe(true);
		expect(matches("/repos/fixa(v2)")).toBe(false);
	});

	it("matches escaped glob characters literally", () => {
		// Given a directory pattern and a glob that escape * and ?.
		const directory = createWorktreePathFilter(["/repos/fix-\\?-bug"]);
		const glob = createWorktreePathFilter(["/repos/wip\\*-*"]);

		// When literal and wildcard-lookalike paths are checked.
		// Then escaped characters only match themselves.
		expect(directory("/repos/fix-?-bug/nested")).toBe(true);
		expect(directory("/repos/fix-a-bug")).toBe(false);
		expect(glob("/repos/wip*-a")).toBe(true);
		expect(glob("/repos/wipx-a")).toBe(false);
	});
});
