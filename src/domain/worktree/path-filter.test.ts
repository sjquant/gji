import { describe, expect, it } from "vitest";
import { matchesPathPatterns, resolvePathPattern } from "./path-filter.js";

describe("worktree path filter", () => {
	it("matches every path when no patterns are given", () => {
		// Given no path patterns.
		// When a worktree path is checked.
		// Then it matches.
		expect(matchesPathPatterns("/repos/worktrees/gji/feature", [])).toBe(true);
	});

	it("matches a plain directory and its descendants only", () => {
		// Given a directory pattern with a trailing separator.
		const patterns = ["/repos/worktrees/gji/"];

		// When paths inside, equal to, and beside the directory are checked.
		// Then only the directory and its descendants match.
		expect(matchesPathPatterns("/repos/worktrees/gji", patterns)).toBe(true);
		expect(matchesPathPatterns("/repos/worktrees/gji/a/b", patterns)).toBe(
			true,
		);
		expect(matchesPathPatterns("/repos/worktrees/gji-other", patterns)).toBe(
			false,
		);
	});

	it("keeps single-star globs within one path segment", () => {
		// Given a single-star glob.
		const patterns = ["/repos/worktrees/gji/feature-*"];

		// When paths in and below the matching segment are checked.
		// Then only the same-segment path matches.
		expect(
			matchesPathPatterns("/repos/worktrees/gji/feature-a", patterns),
		).toBe(true);
		expect(
			matchesPathPatterns("/repos/worktrees/gji/feature-a/nested", patterns),
		).toBe(false);
	});

	it("lets double-star globs span path segments", () => {
		// Given a double-star glob.
		const patterns = ["/repos/**/spike"];

		// When paths at different depths are checked.
		// Then any depth matches, including zero intermediate segments.
		expect(matchesPathPatterns("/repos/spike", patterns)).toBe(true);
		expect(matchesPathPatterns("/repos/worktrees/gji/spike", patterns)).toBe(
			true,
		);
		expect(matchesPathPatterns("/repos/worktrees/gji/spiked", patterns)).toBe(
			false,
		);
	});

	it("treats regex metacharacters literally and ? as one character", () => {
		// Given a glob containing regex metacharacters.
		const patterns = ["/repos/fix.(v?)"];

		// When literal and lookalike paths are checked.
		// Then only literal matches pass.
		expect(matchesPathPatterns("/repos/fix.(v2)", patterns)).toBe(true);
		expect(matchesPathPatterns("/repos/fixa(v2)", patterns)).toBe(false);
	});

	it("matches when any pattern matches", () => {
		// Given two unrelated patterns.
		const patterns = ["/a", "/b/*"];

		// When a path matching only the second is checked.
		// Then it matches.
		expect(matchesPathPatterns("/b/c", patterns)).toBe(true);
		expect(matchesPathPatterns("/c", patterns)).toBe(false);
	});

	it("resolves relative patterns against the working directory", () => {
		// Given a relative glob pattern.
		// When it is resolved from a working directory.
		// Then it becomes an absolute pattern with the glob preserved.
		expect(resolvePathPattern("/repos/gji", "../worktrees/gji/*")).toBe(
			"/repos/worktrees/gji/*",
		);
	});
});
