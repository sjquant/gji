import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { createGoCommand, formatUpstreamHint } from "./go.js";
import {
	addLinkedWorktree,
	createRepository,
	pathExists,
} from "./repo.test-helpers.js";
import { runRootCommand } from "./root.js";

describe("gji root", () => {
	it("prints the main repository root from the repository root", async () => {
		// Given a repository root.
		const repoRoot = await createRepository();
		const stdout: string[] = [];

		// When gji root runs from that repository root.
		const result = await runCli(["root"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints the main repository root path.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("").trim()).toBe(repoRoot);
	});

	it("prints the main repository root from inside a linked worktree", async () => {
		// Given a linked worktree with a nested current working directory.
		const repoRoot = await createRepository();
		const branchName = "feature/root-from-worktree";
		const worktreePath = await addLinkedWorktree(repoRoot, branchName);
		const nestedCwd = join(worktreePath, "nested");
		const stdout: string[] = [];

		await mkdir(nestedCwd, { recursive: true });

		// When gji root runs from inside that linked worktree.
		const result = await runCli(["root"], {
			cwd: nestedCwd,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it still prints the main repository root path.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("").trim()).toBe(repoRoot);
	});

	it("prints the main repository root explicitly with --print", async () => {
		// Given a linked worktree with a nested current working directory.
		const repoRoot = await createRepository();
		const branchName = "feature/root-print";
		const worktreePath = await addLinkedWorktree(repoRoot, branchName);
		const stdout: string[] = [];

		// When gji root runs with --print from inside that linked worktree.
		const result = await runCli(["root", "--print"], {
			cwd: worktreePath,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints the main repository root path.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("").trim()).toBe(repoRoot);
	});

	it("writes the repository root to the shell output file without printing it", async () => {
		// Given a linked worktree and a shell output file.
		const repoRoot = await createRepository();
		const branchName = "feature/root-output-file";
		const worktreePath = await addLinkedWorktree(repoRoot, branchName);
		const outputFile = join(repoRoot, "selected-root.txt");
		const originalOutputFile = process.env.GJI_ROOT_OUTPUT_FILE;
		const stdout: string[] = [];

		process.env.GJI_ROOT_OUTPUT_FILE = outputFile;

		try {
			// When gji root runs via the shell-wrapper output file path.
			const result = await runRootCommand({
				cwd: worktreePath,
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it writes the root to the output file instead of stdout.
			expect(result).toBe(0);
			expect(stdout).toEqual([]);
			await expect(pathExists(outputFile)).resolves.toBe(true);
			await expect(readFile(outputFile, "utf8")).resolves.toBe(`${repoRoot}\n`);
		} finally {
			if (originalOutputFile === undefined) {
				delete process.env.GJI_ROOT_OUTPUT_FILE;
			} else {
				process.env.GJI_ROOT_OUTPUT_FILE = originalOutputFile;
			}
		}
	});
});

describe("gji go", () => {
	it("prints the linked worktree path explicitly with --print", async () => {
		// Given an existing linked worktree for a branch.
		const repoRoot = await createRepository();
		const branchName = "feature/go-print";
		const worktreePath = await addLinkedWorktree(repoRoot, branchName);
		const stdout: string[] = [];

		// When gji go runs in explicit print mode.
		const result = await runCli(["go", "--print", branchName], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints the matching worktree path.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("").trim()).toBe(worktreePath);
	});

	it("prints the linked worktree path for a branch", async () => {
		// Given an existing linked worktree for a branch.
		const repoRoot = await createRepository();
		const branchName = "feature/go-branch";
		const worktreePath = await addLinkedWorktree(repoRoot, branchName);
		const stdout: string[] = [];

		// When gji go runs with that branch name.
		const result = await runCli(["go", branchName], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints the matching worktree path.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("").trim()).toBe(worktreePath);
	});

	it("selects an existing worktree interactively when no branch is provided", async () => {
		// Given an existing linked worktree and an interactive chooser.
		const repoRoot = await createRepository();
		const branchName = "feature/go-select";
		const worktreePath = await addLinkedWorktree(repoRoot, branchName);
		const stdout: string[] = [];
		const stderr: string[] = [];
		const runGoCommand = createGoCommand({
			promptForWorktree: async (worktrees) => {
				expect(worktrees.map((worktree) => worktree.branch)).toContain(
					branchName,
				);
				return worktreePath;
			},
		});

		// When gji go runs without a branch and the chooser selects that worktree.
		const result = await runGoCommand({
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints the selected worktree path.
		expect(result).toBe(0);
		expect(stderr).toEqual([]);
		expect(stdout.join("").trim()).toBe(worktreePath);
	});

	it("writes the selected worktree to the shell output file without printing it", async () => {
		// Given an existing linked worktree and a shell output file.
		const repoRoot = await createRepository();
		const branchName = "feature/go-print-select";
		const worktreePath = await addLinkedWorktree(repoRoot, branchName);
		const outputFile = join(repoRoot, "selected-worktree.txt");
		const originalOutputFile = process.env.GJI_GO_OUTPUT_FILE;
		const stdout: string[] = [];
		const stderr: string[] = [];
		let defaultPromptCalled = false;
		const runGoCommand = createGoCommand({
			promptForWorktree: async (worktrees) => {
				defaultPromptCalled = true;
				expect(worktrees.map((worktree) => worktree.branch)).toContain(
					branchName,
				);
				return worktreePath;
			},
		});

		process.env.GJI_GO_OUTPUT_FILE = outputFile;

		try {
			// When gji go runs without a branch via the shell-wrapper output file path.
			const result = await runGoCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it writes the selection to the output file instead of stdout.
			expect(result).toBe(0);
			expect(defaultPromptCalled).toBe(true);
			expect(stderr).toEqual([]);
			expect(stdout).toEqual([]);
			await expect(pathExists(outputFile)).resolves.toBe(true);
			await expect(readFile(outputFile, "utf8")).resolves.toBe(
				`${worktreePath}\n`,
			);
		} finally {
			if (originalOutputFile === undefined) {
				delete process.env.GJI_GO_OUTPUT_FILE;
			} else {
				process.env.GJI_GO_OUTPUT_FILE = originalOutputFile;
			}
		}
	});

	it("places the current worktree first in the interactive prompt", async () => {
		// Given a repository with two linked worktrees, with one being the current cwd.
		const repoRoot = await createRepository();
		const branchA = "feature/go-order-a";
		const branchB = "feature/go-order-b";
		const worktreeA = await addLinkedWorktree(repoRoot, branchA);
		await addLinkedWorktree(repoRoot, branchB);
		let capturedWorktrees: Array<{
			branch: string | null;
			isCurrent: boolean;
		}> = [];
		const runGoCommand = createGoCommand({
			promptForWorktree: async (worktrees) => {
				capturedWorktrees = worktrees.map((w) => ({
					branch: w.branch,
					isCurrent: w.isCurrent,
				}));
				return worktreeA;
			},
		});

		// When gji go runs interactively from inside worktreeA.
		await runGoCommand({
			cwd: worktreeA,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then the current worktree (worktreeA) appears first with isCurrent: true.
		expect(capturedWorktrees[0]).toEqual({ branch: branchA, isCurrent: true });
		expect(capturedWorktrees.slice(1).every((w) => !w.isCurrent)).toBe(true);
	});

	it("emits a Hint: line when a branch is not found", async () => {
		// Given a repository with no worktree for the requested branch.
		const repoRoot = await createRepository();
		const stderr: string[] = [];

		// When gji go runs with an unknown branch name.
		const result = await runCli(["go", "nonexistent-branch"], {
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it exits 1 and emits a Hint: line pointing to gji ls.
		expect(result.exitCode).toBe(1);
		const stderrText = stderr.join("");
		expect(stderrText).toContain(
			"No worktree found for branch: nonexistent-branch",
		);
		expect(stderrText).toContain("Hint:");
		expect(stderrText).toContain("gji ls");
	});
});

describe("formatUpstreamHint", () => {
	const base = { ahead: 0, behind: 0, status: "clean" as const };

	it("returns null for detached worktrees (branch is null)", () => {
		expect(
			formatUpstreamHint(null, {
				...base,
				hasUpstream: false,
				upstreamGone: false,
			}),
		).toBeNull();
	});

	it('returns "no upstream" when branch has no upstream configured', () => {
		expect(
			formatUpstreamHint("main", {
				...base,
				hasUpstream: false,
				upstreamGone: false,
			}),
		).toBe("no upstream");
	});

	it('returns "upstream gone" when the remote branch was deleted', () => {
		expect(
			formatUpstreamHint("main", {
				...base,
				hasUpstream: true,
				upstreamGone: true,
			}),
		).toBe("upstream gone");
	});

	it('returns "up to date" when ahead and behind are both 0', () => {
		expect(
			formatUpstreamHint("main", {
				...base,
				hasUpstream: true,
				upstreamGone: false,
			}),
		).toBe("up to date");
	});

	it('returns "ahead N" when only ahead', () => {
		expect(
			formatUpstreamHint("main", {
				...base,
				hasUpstream: true,
				upstreamGone: false,
				ahead: 3,
			}),
		).toBe("ahead 3");
	});

	it('returns "behind N" when only behind', () => {
		expect(
			formatUpstreamHint("main", {
				...base,
				hasUpstream: true,
				upstreamGone: false,
				behind: 2,
			}),
		).toBe("behind 2");
	});

	it('returns "ahead N, behind M" when diverged', () => {
		expect(
			formatUpstreamHint("main", {
				...base,
				hasUpstream: true,
				upstreamGone: false,
				ahead: 4,
				behind: 1,
			}),
		).toBe("ahead 4, behind 1");
	});
});
