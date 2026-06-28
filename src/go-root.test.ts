import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { createGoCommand } from "./go.js";
import { HISTORY_FILE_PATH } from "./history.js";
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
	it("resolves a direct query argument by searchable branch text", async () => {
		// Given two linked worktrees where only one branch matches a partial query.
		const repoRoot = await createRepository();
		const matchingPath = await addLinkedWorktree(
			repoRoot,
			"feature/billing-auth",
		);
		await addLinkedWorktree(repoRoot, "feature/profile");
		const stdout: string[] = [];

		// When gji go runs with a partial query argument.
		const result = await runCli(["go", "--print", "billing"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it navigates to the searchable matching worktree.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("").trim()).toBe(matchingPath);
	});

	it("prefers an exact direct query over the current fuzzy match", async () => {
		// Given a current linked worktree whose branch only fuzzily matches another exact branch.
		const repoRoot = await createRepository();
		const currentPath = await addLinkedWorktree(repoRoot, "myfoo");
		const exactPath = await addLinkedWorktree(repoRoot, "foo");
		const stdout: string[] = [];

		// When gji go runs with the exact branch query from the fuzzy current worktree.
		const result = await runCli(["go", "--print", "foo"], {
			cwd: currentPath,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it navigates to the exact match instead of the current fuzzy match.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("").trim()).toBe(exactPath);
	});

	it("does not resolve a blank direct query to the first worktree", async () => {
		// Given a repository with a linked worktree.
		const repoRoot = await createRepository();
		await addLinkedWorktree(repoRoot, "feature/go-blank-query");
		const stderr: string[] = [];

		// When gji go runs with a direct query that trims to empty text.
		const result = await runCli(["go", "--print", "   "], {
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it reports no match instead of silently choosing a worktree.
		expect(result.exitCode).toBe(1);
		expect(stderr.join("")).toContain("No worktree found");
	});

	it("does not resolve an ambiguous repo-name query to the first worktree", async () => {
		// Given a repository with multiple linked worktrees under the same repo name.
		const repoRoot = await createRepository();
		await addLinkedWorktree(repoRoot, "feature/go-repo-query-one");
		await addLinkedWorktree(repoRoot, "feature/go-repo-query-two");
		const stderr: string[] = [];

		// When gji go runs with only the repo name as a direct query.
		const result = await runCli(["go", "--print", basename(repoRoot)], {
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it reports no match instead of silently choosing one worktree.
		expect(result.exitCode).toBe(1);
		expect(stderr.join("")).toContain("No worktree found");
	});

	it("prints the target path when last-used history cannot be written", async () => {
		// Given a valid linked worktree and a history path that cannot be written as a file.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		process.env.GJI_CONFIG_DIR = await mkdtemp(join(tmpdir(), "gji-config-"));
		const repoRoot = await createRepository();
		const branchName = "feature/go-history-unwritable";
		const worktreePath = await addLinkedWorktree(repoRoot, branchName);
		const stdout: string[] = [];

		try {
			await mkdir(HISTORY_FILE_PATH());

			// When gji go navigates successfully.
			const result = await runCli(["go", "--print", branchName], {
				cwd: repoRoot,
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then the auxiliary history write failure does not fail navigation.
			expect(result.exitCode).toBe(0);
			expect(stdout.join("").trim()).toBe(worktreePath);
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
		}
	});

	it("sorts picker entries current first, then recently used, and shows recency", async () => {
		// Given linked worktrees with seeded history metadata.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		process.env.GJI_CONFIG_DIR = await mkdtemp(join(tmpdir(), "gji-config-"));
		const repoRoot = await createRepository();
		const currentBranch = "feature/current-picker";
		const recentBranch = "feature/recent-picker";
		const olderBranch = "feature/older-picker";
		const currentPath = await addLinkedWorktree(repoRoot, currentBranch);
		const recentPath = await addLinkedWorktree(repoRoot, recentBranch);
		const olderPath = await addLinkedWorktree(repoRoot, olderBranch);
		const repoName = repoRoot.split("/").at(-1)!;
		const now = Date.now();
		let capturedEntries: Array<{
			branch: string | null;
			isCurrent: boolean;
			label: string;
		}> = [];
		const runGoCommand = createGoCommand({
			promptForWorktree: async (worktrees) => {
				capturedEntries = worktrees.map((worktree) => ({
					branch: worktree.branch,
					isCurrent: worktree.isCurrent,
					label: worktree.label,
				}));
				return currentPath;
			},
		});

		try {
			await writeFile(
				HISTORY_FILE_PATH(),
				`${JSON.stringify(
					[
						{
							branch: recentBranch,
							path: recentPath,
							timestamp: now - 4 * 60 * 1000,
						},
						{
							branch: olderBranch,
							path: olderPath,
							timestamp: now - 2 * 60 * 60 * 1000,
						},
					],
					null,
					2,
				)}\n`,
				"utf8",
			);

			// When gji go prompts from inside the current worktree.
			const result = await runGoCommand({
				cwd: currentPath,
				stderr: () => undefined,
				stdout: () => undefined,
			});

			// Then the current worktree is first and recency appears in picker hints.
			expect(result).toBe(0);
			expect(capturedEntries[0]).toMatchObject({
				branch: currentBranch,
				isCurrent: true,
			});
			expect(capturedEntries[1].branch).toBe(recentBranch);
			expect(capturedEntries[1].label).toContain(repoName);
			expect(capturedEntries[1].label).toContain(recentBranch);
			expect(capturedEntries[1].label).toContain("last used: 4m ago");
			expect(capturedEntries[1].label).toContain("recent-picker");
			expect(capturedEntries[2].branch).toBe(olderBranch);
			expect(capturedEntries[2].label).toContain("last used: 2h ago");
			expect(capturedEntries[0].label).toContain("[current]");
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
		}
	});

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
