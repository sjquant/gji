import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { saveLocalConfig } from "./config.js";
import { runDoneCommand } from "./done.js";
import {
	addLinkedWorktree,
	commitFile,
	createRepository,
	pathExists,
	runGit,
} from "./repo.test-helpers.js";

afterEach(() => {
	delete process.env.GJI_DONE_OUTPUT_FILE;
	delete process.env.GJI_CONFIG_DIR;
	delete process.env.GJI_NO_TUI;
});

describe("gji done", () => {
	it("requires explicit force when a hook dirties the worktree", async () => {
		// Given a clean linked worktree whose before-remove hook creates an untracked file.
		const repoRoot = await createRepository();
		const branch = "feature/done-hook-dirty";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		await saveLocalConfig(repoRoot, {
			hooks: {
				"before-remove": "touch hook-created.txt",
			},
		});
		const stderr: string[] = [];

		// When headless JSON completion runs without --force.
		const result = await runDoneCommand({
			branch,
			cwd: repoRoot,
			json: true,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it refuses force removal and leaves the worktree intact.
		expect(result).toBe(1);
		expect(stderr.join("")).toContain("force removal");
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(
			pathExists(join(worktreePath, "hook-created.txt")),
		).resolves.toBe(true);
	});

	it("keeps the shell handoff valid when completing an explicit other worktree", async () => {
		// Given a repository root and a linked worktree selected by branch.
		const repoRoot = await createRepository();
		const branch = "feature/done-explicit-target";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		const outputFile = join(
			await mkdtemp(join(tmpdir(), "gji-done-output-")),
			"target",
		);
		process.env.GJI_DONE_OUTPUT_FILE = outputFile;
		const stdout: string[] = [];

		// When gji done removes the explicit target from the main worktree.
		const result = await runDoneCommand({
			branch,
			cwd: repoRoot,
			force: true,
			stderr: () => undefined,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the command succeeds and the wrapper receives a safe current directory.
		expect(result).toBe(0);
		expect(stdout).toEqual([]);
		await expect(pathExists(worktreePath)).resolves.toBe(false);
		await expect(pathExists(outputFile)).resolves.toBe(true);
		expect(await readFile(outputFile, "utf8")).toBe(`${repoRoot}\n`);
	});

	it("fails closed when the undo journal cannot be written", async () => {
		// Given a linked worktree and an undo-log path occupied by a directory.
		const repoRoot = await createRepository();
		const branch = "feature/done-journal-failure";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		const configPath = await mkdtemp(join(tmpdir(), "gji-config-"));
		await mkdir(join(configPath, "undo-log.json"));
		process.env.GJI_CONFIG_DIR = configPath;
		const stderr: string[] = [];

		// When completion attempts to journal before removal.
		const result = await runDoneCommand({
			branch,
			cwd: repoRoot,
			force: true,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it reports the journal failure and preserves the worktree.
		expect(result).toBe(1);
		expect(stderr.join("")).toContain("undo journal");
		await expect(pathExists(worktreePath)).resolves.toBe(true);
	});

	it("uses the configured default branch for merge safety", async () => {
		// Given a target branch merged into configured main but not the current dev branch.
		const repoRoot = await createRepository();
		await runGit(repoRoot, ["branch", "dev"]);
		await runGit(repoRoot, ["checkout", "dev"]);
		const branch = "feature/done-configured-base";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		await commitFile(
			worktreePath,
			"configured-base.txt",
			"target commit\n",
			"Add configured-base change",
		);
		await runGit(repoRoot, ["branch", "-f", "main", branch]);
		await saveLocalConfig(repoRoot, { syncDefaultBranch: "main" });
		const stderr: string[] = [];

		// When gji done evaluates the branch without --force.
		const result = await runDoneCommand({
			branch,
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it accepts the configured merge base and removes the completed worktree.
		expect(result).toBe(0);
		expect(stderr.join("")).not.toContain("use --force");
		await expect(pathExists(worktreePath)).resolves.toBe(false);
		await expect(
			runGit(repoRoot, ["show-ref", "--verify", "refs/heads/dev"]),
		).resolves.toBeTruthy();
	});
});
