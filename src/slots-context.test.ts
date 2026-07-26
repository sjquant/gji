import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { resolveWorktreePath } from "./repo.js";
import {
	createRepository,
	currentBranch,
	pathExists,
} from "./repo.test-helpers.js";
import { SLOTS_FILE_PATH } from "./slots.js";

const originalConfigDir = process.env.GJI_CONFIG_DIR;

afterEach(() => {
	if (originalConfigDir === undefined) delete process.env.GJI_CONFIG_DIR;
	else process.env.GJI_CONFIG_DIR = originalConfigDir;
});

describe("worktree slots and context metadata", () => {
	it("allocates stable slots, exposes task metadata, and reuses released slots", async () => {
		// Given an isolated repository and metadata directory.
		const repoRoot = await createRepository();
		const configDir = join(repoRoot, ".gji-config");
		process.env.GJI_CONFIG_DIR = configDir;

		// When two task-bearing worktrees are created.
		const first = await runCli(
			["new", "--no-fetch", "--task", "first task", "feature/first"],
			{
				cwd: repoRoot,
			},
		);
		const second = await runCli(
			["new", "--no-fetch", "--task", "second task", "feature/second"],
			{
				cwd: repoRoot,
			},
		);
		const slots = JSON.parse(
			await readFile(SLOTS_FILE_PATH(), "utf8"),
		) as Record<string, number>;

		// Then slots are stable and task/status JSON exposes the metadata.
		expect(first.exitCode).toBe(0);
		expect(second.exitCode).toBe(0);
		expect(Object.values(slots)).toEqual(expect.arrayContaining([0, 1, 2]));
		const statusOutput: string[] = [];
		const status = await runCli(["status", "--json"], {
			cwd: repoRoot,
			stdout: (chunk) => statusOutput.push(chunk),
		});
		const statusJson = JSON.parse(statusOutput.join("")) as {
			worktrees: Array<{ slot: number | null; task: string | null }>;
		};
		expect(status.exitCode).toBe(0);
		expect(statusJson.worktrees).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ slot: 1, task: "first task" }),
				expect.objectContaining({ slot: 2, task: "second task" }),
			]),
		);

		const firstPath = Object.keys(slots).find((path) => slots[path] === 1);
		if (!firstPath) throw new Error("first slot was not assigned");
		const removed = await runCli(["remove", "--force", firstPath], {
			cwd: repoRoot,
		});
		expect(removed.exitCode).toBe(0);

		const third = await runCli(["new", "--no-fetch", "feature/third"], {
			cwd: repoRoot,
		});
		const nextSlots = JSON.parse(
			await readFile(SLOTS_FILE_PATH(), "utf8"),
		) as Record<string, number>;
		expect(third.exitCode).toBe(0);
		expect(Object.values(nextSlots)).toContain(1);
	});

	it("renders a context card when entering a task-bearing worktree", async () => {
		// Given a linked worktree with task metadata.
		const repoRoot = await createRepository();
		process.env.GJI_CONFIG_DIR = join(repoRoot, ".gji-config");
		const created = await runCli(
			["new", "--no-fetch", "--task", "review login", "feature/context"],
			{
				cwd: repoRoot,
			},
		);
		expect(created.exitCode).toBe(0);
		const branch = "feature/context";
		const worktreePath = resolveWorktreePath(repoRoot, branch);
		const stderr: string[] = [];

		// When navigation enters that worktree.
		const result = await runCli(["go", branch], {
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
		});

		// Then the context card includes the task without changing the command result.
		expect(result.exitCode).toBe(0);
		expect(stderr.join("")).toContain("task   review login");
		expect(stderr.join("")).toContain("state");
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(currentBranch(worktreePath)).resolves.toBe(branch);
	});

	it("supports updating and clearing the current task", async () => {
		// Given a repository root with no task metadata.
		const repoRoot = await createRepository();
		process.env.GJI_CONFIG_DIR = join(repoRoot, ".gji-config");
		const stdout: string[] = [];

		// When the task is set and then cleared through the CLI.
		const set = await runCli(["task", "document setup"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});
		const clear = await runCli(["task", "--clear"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then both lifecycle operations succeed and the final output reports no task.
		expect(set.exitCode).toBe(0);
		expect(clear.exitCode).toBe(0);
		expect(stdout.join("")).toContain("no task set");
	});
});
