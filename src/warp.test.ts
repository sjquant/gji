import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { HISTORY_FILE_PATH } from "./history.js";
import {
	addLinkedWorktree,
	createRepository,
	currentBranch,
} from "./repo.test-helpers.js";
import { registerRepo } from "./repo-registry.js";
import { resolveWarpTarget, runWarpCommand } from "./warp.js";

const originalConfigDir = process.env.GJI_CONFIG_DIR;

afterEach(() => {
	if (originalConfigDir === undefined) {
		delete process.env.GJI_CONFIG_DIR;
	} else {
		process.env.GJI_CONFIG_DIR = originalConfigDir;
	}
});

async function makeConfigDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gji-config-"));
}

describe("resolveWarpTarget", () => {
	it("returns null with an error when no repos are registered", async () => {
		// Given an empty registry.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;

		// When resolveWarpTarget is called with no repos registered.
		const errors: string[] = [];
		const result = await resolveWarpTarget({
			cwd: "/",
			stderr: (msg) => errors.push(msg),
		});

		// Then it returns null and reports that no repos are registered.
		expect(result).toBeNull();
		expect(errors.join("")).toMatch(/no repos registered yet/);
	});

	it("uses the commandName prefix in error messages", async () => {
		// Given an empty registry and a commandName.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;

		// When resolveWarpTarget is called with a commandName.
		const errors: string[] = [];
		await resolveWarpTarget({
			commandName: "gji warp",
			cwd: "/",
			stderr: (msg) => errors.push(msg),
		});

		// Then the error message is prefixed with the commandName.
		expect(errors.join("")).toMatch(/^gji warp:/);
	});

	it("resolves a worktree by exact branch name", async () => {
		// Given a registered repo with a linked worktree.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;
		const repoRoot = await createRepository();
		const worktreePath = await addLinkedWorktree(repoRoot, "feature/auth");
		await registerRepo(repoRoot);

		// When resolveWarpTarget is called with the exact branch name.
		const result = await resolveWarpTarget({
			branch: "feature/auth",
			cwd: "/",
			stderr: () => undefined,
		});

		// Then it returns the matching worktree path and branch.
		expect(result).not.toBeNull();
		expect(result!.path).toBe(worktreePath);
		expect(result!.branch).toBe("feature/auth");
	});

	it("resolves a worktree by repo/branch query", async () => {
		// Given a registered repo with a linked worktree.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;
		const repoRoot = await createRepository();
		const worktreePath = await addLinkedWorktree(repoRoot, "feature/auth");
		const repoName = repoRoot.split("/").at(-1)!;
		await registerRepo(repoRoot);

		// When resolveWarpTarget is called with a "repo/branch" query.
		const result = await resolveWarpTarget({
			branch: `${repoName}/feature/auth`,
			cwd: "/",
			stderr: () => undefined,
		});

		// Then it returns the matching worktree path.
		expect(result).not.toBeNull();
		expect(result!.path).toBe(worktreePath);
	});

	it("resolves a worktree by fuzzy branch query", async () => {
		// Given a registered repo with multiple linked worktrees.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;
		const repoRoot = await createRepository();
		const matchingPath = await addLinkedWorktree(
			repoRoot,
			"feature/searchable-auth",
		);
		await addLinkedWorktree(repoRoot, "feature/dashboard");
		await registerRepo(repoRoot);

		// When resolveWarpTarget is called with a partial query.
		const result = await resolveWarpTarget({
			branch: "searchable",
			cwd: "/",
			stderr: () => undefined,
		});

		// Then it returns the fuzzy matching worktree path.
		expect(result).not.toBeNull();
		expect(result!.path).toBe(matchingPath);
	});

	it("prefers an exact branch query over the current fuzzy match", async () => {
		// Given a current linked worktree whose branch only fuzzily matches another exact branch.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;
		const repoRoot = await createRepository();
		const currentPath = await addLinkedWorktree(repoRoot, "myfoo");
		const exactPath = await addLinkedWorktree(repoRoot, "foo");
		await registerRepo(repoRoot);

		// When resolveWarpTarget runs with the exact branch query from the fuzzy current worktree.
		const result = await resolveWarpTarget({
			branch: "foo",
			cwd: currentPath,
			stderr: () => undefined,
		});

		// Then it resolves the exact match instead of the current fuzzy match.
		expect(result).not.toBeNull();
		expect(result!.path).toBe(exactPath);
	});

	it("returns null with an error when the branch query has no match", async () => {
		// Given a registered repo with no matching worktree.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;
		const repoRoot = await createRepository();
		await registerRepo(repoRoot);

		// When resolveWarpTarget is called with a non-existent branch.
		const errors: string[] = [];
		const result = await resolveWarpTarget({
			branch: "no-such-branch",
			cwd: "/",
			stderr: (msg) => errors.push(msg),
		});

		// Then it returns null and reports that no worktree was found.
		expect(result).toBeNull();
		expect(errors.join("")).toMatch(/no worktree found matching/);
	});

	it("includes the main worktree in results", async () => {
		// Given a registered repo with only the main worktree.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;
		const repoRoot = await createRepository();
		await registerRepo(repoRoot);

		// When resolveWarpTarget is called with the main branch name.
		const branch = await currentBranch(repoRoot);
		const result = await resolveWarpTarget({
			branch,
			cwd: "/",
			stderr: () => undefined,
		});

		// Then it returns the repo root as the matching path.
		expect(result).not.toBeNull();
		expect(result!.path).toBe(repoRoot);
	});
});

describe("gji warp --json", () => {
	it("outputs a JSON error when no branch is provided", async () => {
		// Given an empty registry and json mode with no branch argument.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;

		// When runWarpCommand is called with json: true and no branch.
		const errors: string[] = [];
		const exitCode = await runWarpCommand({
			cwd: "/",
			json: true,
			stderr: (msg) => errors.push(msg),
			stdout: () => undefined,
		});

		// Then it exits 1 and emits a JSON error object.
		expect(exitCode).toBe(1);
		const parsed = JSON.parse(errors.join(""));
		expect(parsed).toHaveProperty("error");
	});

	it("outputs JSON with repository metadata when navigating to an existing worktree", async () => {
		// Given a registered repo with a linked worktree.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;
		const repoRoot = await createRepository();
		const worktreePath = await addLinkedWorktree(repoRoot, "feature/json-test");
		await registerRepo(repoRoot);

		// When runWarpCommand is called with json: true and a matching branch.
		const outputs: string[] = [];
		const exitCode = await runWarpCommand({
			branch: "feature/json-test",
			cwd: "/",
			json: true,
			stderr: () => undefined,
			stdout: (msg) => outputs.push(msg),
		});

		// Then it exits 0 and emits the branch and path as JSON.
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(outputs.join(""));
		expect(parsed.branch).toBe("feature/json-test");
		expect(parsed.path).toBe(worktreePath);
		expect(parsed.repository).toEqual({
			name: repoRoot.split("/").at(-1),
			root: repoRoot,
		});
	});

	it("outputs a JSON error when no repos are registered", async () => {
		// Given an empty registry and a branch argument.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;

		// When runWarpCommand is called with json: true and a branch but no repos.
		const errors: string[] = [];
		const exitCode = await runWarpCommand({
			branch: "feature/any",
			cwd: "/",
			json: true,
			stderr: (msg) => errors.push(msg),
			stdout: () => undefined,
		});

		// Then it exits 1 and emits a JSON error describing the missing registry.
		expect(exitCode).toBe(1);
		const parsed = JSON.parse(errors.join(""));
		expect(parsed).toHaveProperty("error");
		expect(parsed.error).toMatch(/no repos registered yet/);
	});
});

describe("gji warp", () => {
	it("writes the target path when last-used history cannot be written", async () => {
		// Given a registered repo and a history path that cannot be written as a file.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;
		const repoRoot = await createRepository();
		const branch = "feature/warp-history-unwritable";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		const outputs: string[] = [];
		await registerRepo(repoRoot);
		await mkdir(HISTORY_FILE_PATH());

		// When gji warp navigates successfully.
		const exitCode = await runWarpCommand({
			branch,
			cwd: repoRoot,
			stderr: () => undefined,
			stdout: (msg) => outputs.push(msg),
		});

		// Then the auxiliary history write failure does not fail navigation.
		expect(exitCode).toBe(0);
		expect(outputs.join("").trim()).toBe(worktreePath);
	});
});
