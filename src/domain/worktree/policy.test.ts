import { describe, expect, it } from "vitest";
import { resolveWorktreePath, validateBranchName } from "./policy.js";

describe("worktree policy", () => {
	it("resolves nested branch paths under the repository worktree directory", () => {
		// Given a repository and a nested branch name.
		// When the policy resolves its worktree path.
		const path = resolveWorktreePath("/tmp/repos/gji", "feature/review");

		// Then the path follows the stable worktree layout.
		expect(path).toBe("/tmp/repos/worktrees/gji/feature/review");
	});

	it("honors an absolute custom worktree directory", () => {
		// Given an explicit worktree directory.
		// When the policy resolves a branch path.
		const path = resolveWorktreePath(
			"/tmp/repos/gji",
			"feature/review",
			"/custom/worktrees",
		);

		// Then the custom directory is used without changing the branch layout.
		expect(path).toBe("/custom/worktrees/feature/review");
	});

	it("expands a tilde-prefixed custom worktree directory", () => {
		// Given a custom directory using the home-directory shorthand.
		// When the policy resolves a branch path.
		const path = resolveWorktreePath("/tmp/repos/gji", "main", "~/worktrees");

		// Then the result contains an expanded absolute path.
		expect(path).toMatch(/\/worktrees\/main$/);
		expect(path).not.toContain("~");
	});

	it.each([
		"",
		".",
		"..",
		"feature/./bad",
		"feature/../bad",
	])("rejects unsafe branch path %j", (branch) => {
		// Given a branch path Git cannot represent safely.
		// When the policy resolves its worktree path.
		// Then resolution fails before a path is constructed.
		expect(() => resolveWorktreePath("/tmp/repos/gji", branch)).toThrow();
	});

	it.each([
		"main",
		"feature/foo",
		"fix/my-bug",
		"release-1.0",
		"v2.0.0",
		"feature/nested/thing",
	])("accepts valid branch name %j", (name) => {
		// Given a valid Git branch name.
		// When the policy validates it.
		// Then no validation error is returned.
		expect(validateBranchName(name)).toBeNull();
	});

	it("rejects branch names that Git cannot represent safely", () => {
		// Given invalid branch-name forms.
		// When the policy validates each name.
		const errors = ["", "-bad", "feature/../bad", "feature/.hidden"].map(
			(name) => validateBranchName(name),
		);

		// Then every invalid name produces an actionable validation error.
		expect(errors.every((error) => error !== null)).toBe(true);
	});

	it.each([
		"has space",
		"has~tilde",
		"has^caret",
		"has:colon",
		"has?question",
		"has*star",
		"has[bracket",
		"has\\backslash",
		"feat..bad",
		"feature.",
		"foo@{bar}",
		"@",
		"feature/.hidden",
		"feature/bad.lock",
		"/feature",
		"feature/",
		"feature//bad",
	])("rejects invalid branch name %j", (name) => {
		// Given a branch name Git cannot represent safely.
		// When the policy validates it.
		// Then an actionable validation error is returned.
		expect(validateBranchName(name)).not.toBeNull();
	});
});
