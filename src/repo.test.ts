import { execFile } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
	detectRepository,
	resolveWorktreePath,
	validateBranchName,
} from "./repo.js";
import { createRepository } from "./repo.test-helpers.js";

const execFileAsync = promisify(execFile);

describe("detectRepository", () => {
	it("finds the main repository root from the repository root", async () => {
		const repoRoot = await createRepository();

		const result = await detectRepository(repoRoot);

		expect(result).toMatchObject({
			currentRoot: repoRoot,
			isWorktree: false,
			repoName: "gji-test-repo",
			repoRoot,
		});
	});

	it("finds the main repository root from a nested linked worktree path", async () => {
		const repoRoot = await createRepository();
		const branchName = "feature/nested-path";
		const worktreePath = resolveWorktreePath(repoRoot, branchName);

		await runGit(repoRoot, ["branch", branchName]);
		await runGit(repoRoot, ["worktree", "add", worktreePath, branchName]);
		await mkdir(join(worktreePath, "deep", "inside"), { recursive: true });
		const realWorktreePath = await realpath(worktreePath);

		const result = await detectRepository(join(worktreePath, "deep", "inside"));

		expect(result).toMatchObject({
			currentRoot: realWorktreePath,
			isWorktree: true,
			repoName: "gji-test-repo",
			repoRoot,
		});
	});
});

describe("resolveWorktreePath", () => {
	it("uses the ../worktrees/{repo}/{branch} layout", () => {
		expect(resolveWorktreePath("/tmp/repos/gji", "feature/test-branch")).toBe(
			"/tmp/repos/worktrees/gji/feature/test-branch",
		);
	});

	it("uses a custom base path when provided", () => {
		expect(
			resolveWorktreePath("/tmp/repos/gji", "feature/foo", "/custom/base"),
		).toBe("/custom/base/feature/foo");
	});

	it("expands a tilde-prefixed custom base path", () => {
		const result = resolveWorktreePath("/tmp/repos/gji", "main", "~/worktrees");
		expect(result).toMatch(/\/worktrees\/main$/);
		expect(result).not.toContain("~");
	});

	it.each([
		"",
		".",
		"..",
		"feature/./bad",
		"feature/../bad",
	])("rejects invalid branch path %j", (branch) => {
		expect(() => resolveWorktreePath("/tmp/repos/gji", branch)).toThrow();
	});
});

describe("validateBranchName", () => {
	it.each([
		"main",
		"feature/foo",
		"fix/my-bug",
		"release-1.0",
		"v2.0.0",
		"feature/nested/thing",
	])("accepts valid branch name %j", (name) => {
		expect(validateBranchName(name)).toBeNull();
	});

	it("rejects an empty string", () => {
		expect(validateBranchName("")).not.toBeNull();
	});

	it("rejects a name starting with a dash", () => {
		expect(validateBranchName("-bad")).not.toBeNull();
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
	])("rejects name containing an invalid character: %j", (name) => {
		expect(validateBranchName(name)).not.toBeNull();
	});

	it('rejects a name containing ".."', () => {
		expect(validateBranchName("feat..bad")).not.toBeNull();
	});

	it('rejects a name ending with "."', () => {
		expect(validateBranchName("feature.")).not.toBeNull();
	});

	it('rejects a name containing "@{"', () => {
		expect(validateBranchName("foo@{bar}")).not.toBeNull();
	});

	it('rejects the lone "@" name', () => {
		expect(validateBranchName("@")).not.toBeNull();
	});

	it('rejects a path component starting with "."', () => {
		expect(validateBranchName("feature/.hidden")).not.toBeNull();
	});

	it('rejects a path component ending with ".lock"', () => {
		expect(validateBranchName("feature/bad.lock")).not.toBeNull();
	});

	it("rejects a name with leading slash", () => {
		expect(validateBranchName("/feature")).not.toBeNull();
	});

	it("rejects a name with trailing slash", () => {
		expect(validateBranchName("feature/")).not.toBeNull();
	});

	it("rejects a name with consecutive slashes", () => {
		expect(validateBranchName("feature//bad")).not.toBeNull();
	});
});
async function runGit(cwd: string, args: string[]): Promise<void> {
	await execFileAsync("git", args, { cwd });
}
