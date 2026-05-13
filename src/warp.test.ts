import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
	addLinkedWorktree,
	createRepository,
	currentBranch,
} from "./repo.test-helpers.js";
import { REGISTRY_FILE_PATH, registerRepo } from "./repo-registry.js";
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

	it("outputs JSON { branch, path } when navigating to an existing worktree", async () => {
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

	it("outputs JSON { branch, path } when creating a new worktree with --new", async () => {
		// Given a registered repo with no existing worktrees for the target branch.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;
		const repoRoot = await createRepository();
		await registerRepo(repoRoot);

		// When runWarpCommand is called with json: true, newWorktree: true, and a branch.
		const outputs: string[] = [];
		const exitCode = await runWarpCommand({
			branch: "feature/warp-new-json",
			cwd: "/",
			json: true,
			newWorktree: true,
			stderr: () => undefined,
			stdout: (msg) => outputs.push(msg),
		});

		// Then it exits 0 and emits the created branch and path as JSON.
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(outputs.join(""));
		expect(parsed.branch).toBe("feature/warp-new-json");
		expect(typeof parsed.path).toBe("string");
	});

	it("creates a new worktree when the registry contains duplicate entries for the same repo", async () => {
		// Given a registry file that repeats the same repo entry.
		const configDir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = configDir;
		const repoRoot = await createRepository();
		const repoName = repoRoot.split("/").at(-1)!;
		await writeFile(
			REGISTRY_FILE_PATH(),
			`${JSON.stringify(
				[
					{ path: repoRoot, name: repoName, lastUsed: 2000 },
					{ path: repoRoot, name: repoName, lastUsed: 1000 },
				],
				null,
				2,
			)}\n`,
			"utf8",
		);

		// When runWarpCommand creates a new worktree in json mode.
		const outputs: string[] = [];
		const errors: string[] = [];
		const exitCode = await runWarpCommand({
			branch: "feature/warp-new-deduped",
			cwd: "/",
			json: true,
			newWorktree: true,
			stderr: (msg) => errors.push(msg),
			stdout: (msg) => outputs.push(msg),
		});

		// Then it succeeds without treating the duplicates as multiple repos.
		expect(exitCode).toBe(0);
		expect(errors).toEqual([]);
		const parsed = JSON.parse(outputs.join(""));
		expect(parsed.branch).toBe("feature/warp-new-deduped");
		expect(typeof parsed.path).toBe("string");
	});
});
