import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { createGoCommand } from "./go.js";
import { appendHistory, HISTORY_FILE_PATH } from "./history.js";
import { resolveWorktreePath } from "./repo.js";
import {
	addLinkedWorktree,
	createRepository,
	createRepositoryWithOrigin,
	pathExists,
	runGit,
} from "./repo.test-helpers.js";
import { registerRepo } from "./repo-registry.js";
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

	it("supports go --root as a navigation alias for the main repository root", async () => {
		// Given a linked worktree with a separate shell output collector.
		const repoRoot = await createRepository();
		const worktreePath = await addLinkedWorktree(repoRoot, "feature/go-root");
		const stdout: string[] = [];

		// When gji go --root runs with --print from inside the linked worktree.
		const result = await runCli(["go", "--root", "--print"], {
			cwd: worktreePath,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints the main repository root.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("").trim()).toBe(repoRoot);
	});

	it("includes repository metadata in go --root JSON output", async () => {
		// Given a linked worktree and a JSON output collector.
		const repoRoot = await createRepository();
		const worktreePath = await addLinkedWorktree(
			repoRoot,
			"feature/go-root-json",
		);
		const stdout: string[] = [];

		// When gji go --root --json runs from the linked worktree.
		const result = await runCli(["go", "--root", "--json"], {
			cwd: worktreePath,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it returns the repository root as a structured navigation target.
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(stdout.join(""))).toEqual({
			branch: expect.any(String),
			path: repoRoot,
			repository: { name: basename(repoRoot), root: repoRoot },
		});
	});

	it("hands go --root to the shell integration output file", async () => {
		// Given a linked worktree and a temporary shell handoff file.
		const repoRoot = await createRepository();
		const worktreePath = await addLinkedWorktree(
			repoRoot,
			"feature/go-root-handoff",
		);
		const outputFile = join(repoRoot, "selected-go-root.txt");
		const originalOutputFile = process.env.GJI_GO_OUTPUT_FILE;
		const stdout: string[] = [];
		process.env.GJI_GO_OUTPUT_FILE = outputFile;

		try {
			// When gji go --root runs without --print.
			const result = await runCli(["go", "--root"], {
				cwd: worktreePath,
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it writes the root to the handoff file instead of stdout.
			expect(result.exitCode).toBe(0);
			expect(stdout).toEqual([]);
			expect(await readFile(outputFile, "utf8")).toBe(`${repoRoot}\n`);
		} finally {
			if (originalOutputFile === undefined) {
				delete process.env.GJI_GO_OUTPUT_FILE;
			} else {
				process.env.GJI_GO_OUTPUT_FILE = originalOutputFile;
			}
		}
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
	it("explains how to register a repository when go has no sources", async () => {
		// Given a directory outside Git and an empty repository registry.
		const cwd = await mkdtemp(join(tmpdir(), "gji-go-empty-"));
		const stderr: string[] = [];
		const runGoCommand = createGoCommand({
			promptForWorktree: async (entries) => {
				expect(entries).toEqual([]);
				return null;
			},
		});

		// When gji go is invoked without a current repository or branch.
		const result = await runGoCommand({
			cwd,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it gives registration guidance instead of an empty-picker abort.
		expect(result).toBe(1);
		expect(stderr.join("")).toContain("no repos registered yet");
		expect(stderr.join("")).toContain("register it");
	});

	it("requires a repository for pull request references", async () => {
		// Given a registered repository with a pull request worktree and an external cwd.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		process.env.GJI_CONFIG_DIR = await mkdtemp(
			join(tmpdir(), "gji-go-pr-outside-"),
		);
		const repoRoot = await createRepository();
		await addLinkedWorktree(repoRoot, "pr/123");
		await registerRepo(repoRoot);
		const cwd = await mkdtemp(join(tmpdir(), "gji-go-pr-cwd-"));
		const stderr: string[] = [];

		try {
			// When gji go receives a pull request reference outside Git.
			const result = await createGoCommand()({
				branch: "123",
				cwd,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it rejects the reference instead of navigating a registered worktree.
			expect(result).toBe(1);
			expect(stderr.join("")).toContain(
				"PR references must be resolved from inside a git repository",
			);
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
		}
	});

	it("adds a doctor hint when registered repositories are stale", async () => {
		// Given a registry entry whose repository path has been removed.
		const staleRepo = await createRepository();
		await registerRepo(staleRepo);
		await rm(staleRepo, { force: true, recursive: true });
		const cwd = await mkdtemp(join(tmpdir(), "gji-go-stale-registry-"));
		const stderr: string[] = [];
		const runGoCommand = createGoCommand({
			promptForWorktree: async () => null,
		});

		// When gji go is invoked without any accessible worktree source.
		const result = await runGoCommand({
			cwd,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it points users to the stale-entry diagnostic.
		expect(result).toBe(1);
		expect(stderr.join("")).toContain("gji doctor");
	});

	it("creates a worktree for an existing local branch after confirmation", async () => {
		// Given a local branch that is not checked out in a worktree.
		const repoRoot = await createRepository();
		const branchName = "feature/go-existing-branch";
		await runGit(repoRoot, ["branch", branchName]);
		const stdout: string[] = [];
		const runGoCommand = createGoCommand({
			confirmBranchCreation: async () => true,
		});

		// When gji go resolves the existing branch.
		const result = await runGoCommand({
			branch: branchName,
			cwd: repoRoot,
			stderr: () => undefined,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it creates the linked worktree and hands off its path.
		const worktreePath = join(
			repoRoot,
			"..",
			"worktrees",
			basename(repoRoot),
			"feature",
			"go-existing-branch",
		);
		expect(result).toBe(0);
		expect(await pathExists(worktreePath)).toBe(true);
		expect(stdout.join("")).toBe(`${worktreePath}\n`);
	});

	it("creates a tracking worktree for a remote-only branch after confirmation", async () => {
		// Given a remote branch whose local branch has been deleted.
		const { repoRoot } = await createRepositoryWithOrigin();
		const branchName = "feature/go-remote-branch";
		await runGit(repoRoot, ["checkout", "-b", branchName]);
		await runGit(repoRoot, ["push", "-u", "origin", branchName]);
		await runGit(repoRoot, ["checkout", "-"]);
		await runGit(repoRoot, ["branch", "-D", branchName]);
		const stdout: string[] = [];
		const runGoCommand = createGoCommand({
			confirmBranchCreation: async () => true,
		});

		// When gji go resolves the remote-only branch.
		const result = await runGoCommand({
			branch: branchName,
			cwd: repoRoot,
			stderr: () => undefined,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it creates a tracking worktree from the configured remote.
		const worktreePath = resolveWorktreePath(repoRoot, branchName);
		expect(result).toBe(0);
		expect(await pathExists(worktreePath)).toBe(true);
		expect(stdout.join("")).toBe(`${worktreePath}\n`);
		expect(
			await runGit(worktreePath, [
				"rev-parse",
				"--abbrev-ref",
				"--symbolic-full-name",
				"@{upstream}",
			]),
		).toBe(`origin/${branchName}`);
	});

	it("returns JSON without creating a worktree for an existing branch", async () => {
		// Given a local branch that does not have a worktree.
		const repoRoot = await createRepository();
		const branchName = "feature/go-json-create-guard";
		await runGit(repoRoot, ["branch", branchName]);
		const stdout: string[] = [];
		const stderr: string[] = [];

		// When gji go --json is asked to resolve that branch.
		const result = await runCli(["go", "--json", branchName], {
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it refuses the write and reports a structured error.
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(stderr.join(""))).toMatchObject({
			error: expect.any(String),
		});
		expect(stdout).toEqual([]);
		expect(
			await runGit(repoRoot, ["worktree", "list", "--porcelain"]),
		).not.toContain(branchName);
	});

	it("prefers an exact local branch over a fuzzy current worktree", async () => {
		// Given a fuzzy worktree and an exact local branch without a worktree.
		const repoRoot = await createRepository();
		await addLinkedWorktree(repoRoot, "feature/go-fuzzy-old");
		const branchName = "feature/go-fuzzy";
		await runGit(repoRoot, ["branch", branchName]);
		const stdout: string[] = [];
		const runGoCommand = createGoCommand({
			confirmBranchCreation: async () => true,
		});

		// When gji go resolves the exact branch.
		const result = await runGoCommand({
			branch: branchName,
			cwd: repoRoot,
			stderr: () => undefined,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it creates the exact branch worktree instead of choosing the fuzzy one.
		expect(result).toBe(0);
		expect(stdout.join("")).toBe(
			`${resolveWorktreePath(repoRoot, branchName)}\n`,
		);
	});

	it("prefers an exact numeric branch over a pull request worktree", async () => {
		// Given a local numeric branch and a pr/123 worktree.
		const repoRoot = await createRepository();
		await addLinkedWorktree(repoRoot, "pr/123");
		await runGit(repoRoot, ["branch", "123"]);
		const stdout: string[] = [];
		const runGoCommand = createGoCommand({
			confirmBranchCreation: async () => true,
		});

		// When gji go resolves the numeric branch.
		const result = await runGoCommand({
			branch: "123",
			cwd: repoRoot,
			stderr: () => undefined,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it creates the exact branch worktree instead of selecting pr/123.
		expect(result).toBe(0);
		expect(stdout.join("")).toBe(`${resolveWorktreePath(repoRoot, "123")}\n`);
	});

	it("prefers the current pull request worktree over a registered duplicate", async () => {
		// Given pr/123 worktrees in the current and another registered repository.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		process.env.GJI_CONFIG_DIR = await mkdtemp(
			join(tmpdir(), "gji-go-pr-current-"),
		);
		const currentRepo = await createRepository();
		const otherRepo = await createRepository();
		const currentPath = await addLinkedWorktree(currentRepo, "pr/123");
		await addLinkedWorktree(otherRepo, "pr/123");
		await registerRepo(otherRepo);
		const stdout: string[] = [];

		try {
			// When gji go resolves the numeric pull request reference.
			const result = await createGoCommand()({
				branch: "123",
				cwd: currentRepo,
				stderr: () => undefined,
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it navigates to the current repository's worktree.
			expect(result).toBe(0);
			expect(stdout.join("")).toBe(`${currentPath}\n`);
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
		}
	});

	it("prefers an exact numeric remote branch over a pull request worktree", async () => {
		// Given a remote-only numeric branch and a pr/123 worktree.
		const { repoRoot } = await createRepositoryWithOrigin();
		await addLinkedWorktree(repoRoot, "pr/123");
		await runGit(repoRoot, ["branch", "123"]);
		await runGit(repoRoot, ["checkout", "123"]);
		await runGit(repoRoot, ["push", "-u", "origin", "123"]);
		await runGit(repoRoot, ["checkout", "-"]);
		await runGit(repoRoot, ["branch", "-D", "123"]);
		const stdout: string[] = [];
		const runGoCommand = createGoCommand({
			confirmBranchCreation: async () => true,
		});

		// When gji go resolves the remote-only numeric branch.
		const result = await runGoCommand({
			branch: "123",
			cwd: repoRoot,
			stderr: () => undefined,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it creates the remote branch worktree instead of selecting pr/123.
		expect(result).toBe(0);
		expect(stdout.join("")).toBe(`${resolveWorktreePath(repoRoot, "123")}\n`);
	});

	it("uses go - as the previous-worktree toggle", async () => {
		// Given two worktrees with the second one most recently visited.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		process.env.GJI_CONFIG_DIR = await mkdtemp(
			join(tmpdir(), "gji-go-history-"),
		);
		const repoRoot = await createRepository();
		const worktreeA = await addLinkedWorktree(repoRoot, "feature/go-back-a");
		const worktreeB = await addLinkedWorktree(repoRoot, "feature/go-back-b");
		await appendHistory(worktreeA, "feature/go-back-a");
		await appendHistory(worktreeB, "feature/go-back-b");
		const stdout: string[] = [];

		try {
			// When gji go - runs from the most recent worktree.
			const result = await runCli(["go", "-", "--print"], {
				cwd: worktreeB,
				stdout: (chunk) => stdout.push(chunk),
				stderr: () => undefined,
			});

			// Then it returns to the preceding worktree.
			expect(result.exitCode).toBe(0);
			expect(stdout.join("")).toBe(`${worktreeA}\n`);
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
		}
	});

	it("returns the previous worktree as JSON without shell handoff", async () => {
		// Given history with a previous worktree.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		process.env.GJI_CONFIG_DIR = await mkdtemp(
			join(tmpdir(), "gji-go-history-json-"),
		);
		const repoRoot = await createRepository();
		const worktreeA = await addLinkedWorktree(repoRoot, "feature/go-json-a");
		const worktreeB = await addLinkedWorktree(repoRoot, "feature/go-json-b");
		await appendHistory(worktreeA, "feature/go-json-a");
		await appendHistory(worktreeB, "feature/go-json-b");
		const stdout: string[] = [];
		const stderr: string[] = [];

		try {
			// When gji go - --json runs from the most recent worktree.
			const result = await runCli(["go", "-", "--json"], {
				cwd: worktreeB,
				stderr: (chunk) => stderr.push(chunk),
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it returns structured data without invoking shell handoff.
			expect(result.exitCode).toBe(0);
			expect(stderr).toEqual([]);
			expect(JSON.parse(stdout.join(""))).toEqual({
				branch: "feature/go-json-a",
				path: worktreeA,
				repository: {
					name: basename(repoRoot),
					root: repoRoot,
				},
			});
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
		}
	});

	it("resolves a matching worktree in a registered repository", async () => {
		// Given a current repository and a different registered repository.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		process.env.GJI_CONFIG_DIR = await mkdtemp(join(tmpdir(), "gji-go-warp-"));
		const currentRepo = await createRepository();
		const otherRepo = await createRepository();
		const branchName = "feature/go-cross-repo";
		const targetPath = await addLinkedWorktree(otherRepo, branchName);
		await registerRepo(otherRepo);
		const stdout: string[] = [];

		try {
			// When gji go resolves the branch from the current repository.
			const result = await runCli(["go", "--print", branchName], {
				cwd: currentRepo,
				stdout: (chunk) => stdout.push(chunk),
				stderr: () => undefined,
			});

			// Then it navigates to the registered repository's worktree.
			expect(result.exitCode).toBe(0);
			expect(stdout.join("")).toBe(`${targetPath}\n`);
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
		}
	});

	it("does not emit current-repository config warnings for a cross-repository match", async () => {
		// Given an unknown config key in the current repository and a registered target repository.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		process.env.GJI_CONFIG_DIR = await mkdtemp(
			join(tmpdir(), "gji-go-cross-warning-"),
		);
		const currentRepo = await createRepository();
		await writeFile(
			join(currentRepo, ".gji.json"),
			JSON.stringify({ unknownKey: true }),
			"utf8",
		);
		const otherRepo = await createRepository();
		const branchName = "feature/go-cross-warning";
		const targetPath = await addLinkedWorktree(otherRepo, branchName);
		await registerRepo(otherRepo);
		const stdout: string[] = [];
		const stderr: string[] = [];

		try {
			// When gji go resolves the registered repository's worktree.
			const result = await runCli(["go", "--print", branchName], {
				cwd: currentRepo,
				stderr: (chunk) => stderr.push(chunk),
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it navigates without reporting an unused current-repository warning.
			expect(result.exitCode).toBe(0);
			expect(stdout.join("")).toBe(`${targetPath}\n`);
			expect(stderr.join("")).not.toContain("unknownKey");
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
		}
	});

	it("prefers a registered worktree over an unlinked local branch", async () => {
		// Given an unlinked local branch and a linked worktree in another registered repository.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		process.env.GJI_CONFIG_DIR = await mkdtemp(
			join(tmpdir(), "gji-go-cross-local-"),
		);
		const currentRepo = await createRepository();
		const otherRepo = await createRepository();
		const branchName = "feature/go-cross-local";
		await runGit(currentRepo, ["branch", branchName]);
		const targetPath = await addLinkedWorktree(otherRepo, branchName);
		await registerRepo(otherRepo);
		const stdout: string[] = [];

		try {
			// When gji go resolves the branch from the current repository.
			const result = await runCli(["go", "--print", branchName], {
				cwd: currentRepo,
				stdout: (chunk) => stdout.push(chunk),
				stderr: () => undefined,
			});

			// Then it navigates to the existing registered worktree.
			expect(result.exitCode).toBe(0);
			expect(stdout.join("")).toBe(`${targetPath}\n`);
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
		}
	});

	it("prefers an exact local numeric branch over a registered pull request worktree", async () => {
		// Given a local numeric branch and pr/123 in another registered repository.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		process.env.GJI_CONFIG_DIR = await mkdtemp(
			join(tmpdir(), "gji-go-cross-numeric-"),
		);
		const currentRepo = await createRepository();
		const otherRepo = await createRepository();
		await runGit(currentRepo, ["branch", "123"]);
		await addLinkedWorktree(otherRepo, "pr/123");
		await registerRepo(otherRepo);
		const stdout: string[] = [];
		const runGoCommand = createGoCommand({
			confirmBranchCreation: async () => true,
		});

		try {
			// When gji go resolves the numeric branch from the current repository.
			const result = await runGoCommand({
				branch: "123",
				cwd: currentRepo,
				stderr: () => undefined,
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it creates the local branch worktree instead of selecting pr/123.
			expect(result).toBe(0);
			expect(stdout.join("")).toBe(
				`${resolveWorktreePath(currentRepo, "123")}\n`,
			);
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
		}
	});

	it("prefers a registered worktree over a remote-only branch", async () => {
		// Given a remote-only branch and a linked worktree in another registered repository.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		process.env.GJI_CONFIG_DIR = await mkdtemp(
			join(tmpdir(), "gji-go-cross-remote-"),
		);
		const { repoRoot: currentRepo } = await createRepositoryWithOrigin();
		const otherRepo = await createRepository();
		const branchName = "feature/go-cross-remote";
		await runGit(currentRepo, ["checkout", "-b", branchName]);
		await runGit(currentRepo, ["push", "-u", "origin", branchName]);
		await runGit(currentRepo, ["checkout", "-"]);
		await runGit(currentRepo, ["branch", "-D", branchName]);
		const targetPath = await addLinkedWorktree(otherRepo, branchName);
		await registerRepo(otherRepo);
		const stdout: string[] = [];

		try {
			// When gji go resolves the branch from the current repository.
			const result = await runCli(["go", "--print", branchName], {
				cwd: currentRepo,
				stdout: (chunk) => stdout.push(chunk),
				stderr: () => undefined,
			});

			// Then it navigates to the existing registered worktree.
			expect(result.exitCode).toBe(0);
			expect(stdout.join("")).toBe(`${targetPath}\n`);
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
		}
	});

	it("reports cross-repository ambiguity in headless mode", async () => {
		// Given two registered repositories with the same matching branch.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		const originalHeadless = process.env.GJI_NO_TUI;
		process.env.GJI_CONFIG_DIR = await mkdtemp(
			join(tmpdir(), "gji-go-ambiguous-"),
		);
		process.env.GJI_NO_TUI = "1";
		const currentRepo = await createRepository();
		const firstRepo = await createRepository();
		const secondRepo = await createRepository();
		const branchName = "feature/go-ambiguous";
		await addLinkedWorktree(firstRepo, branchName);
		await addLinkedWorktree(secondRepo, branchName);
		await registerRepo(firstRepo);
		await registerRepo(secondRepo);
		const stderr: string[] = [];

		try {
			// When gji go resolves the ambiguous branch without a TTY.
			const result = await runCli(["go", branchName], {
				cwd: currentRepo,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it fails with the candidate repositories instead of choosing one.
			expect(result.exitCode).toBe(1);
			expect(stderr.join("")).toContain("multiple worktrees match");
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
			if (originalHeadless === undefined) {
				delete process.env.GJI_NO_TUI;
			} else {
				process.env.GJI_NO_TUI = originalHeadless;
			}
		}
	});

	it("rejects a PR URL that belongs to another repository", async () => {
		// Given a repository whose origin does not match the PR URL.
		const { repoRoot } = await createRepositoryWithOrigin();
		const stderr: string[] = [];

		// When gji go receives the unrelated PR URL.
		const result = await runCli(
			["go", "https://github.com/other/repo/pull/123"],
			{
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			},
		);

		// Then it rejects the URL before attempting a fetch.
		expect(result.exitCode).toBe(1);
		expect(stderr.join("")).toContain("does not belong to this repository");
	});

	it("does not treat a foreign PR URL as a local PR worktree", async () => {
		// Given a local pr/123 worktree and a different repository origin.
		const repoRoot = await createRepository();
		await runGit(repoRoot, [
			"remote",
			"add",
			"origin",
			"https://github.com/example/project.git",
		]);
		await addLinkedWorktree(repoRoot, "pr/123");
		const stderr: string[] = [];

		// When gji go receives a foreign PR URL with the same number.
		const result = await runCli(
			["go", "https://github.com/other/project/pull/123"],
			{
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			},
		);

		// Then it rejects the URL instead of navigating to pr/123.
		expect(result.exitCode).toBe(1);
		expect(stderr.join("")).toContain("does not belong to this repository");
	});

	it("resolves a same-repository PR URL to an existing PR worktree", async () => {
		// Given an origin URL and an existing pr/123 worktree.
		const repoRoot = await createRepository();
		await runGit(repoRoot, [
			"remote",
			"add",
			"origin",
			"https://github.com/example/project.git",
		]);
		const worktreePath = await addLinkedWorktree(repoRoot, "pr/123");
		const stdout: string[] = [];

		// When gji go receives the matching PR URL in JSON mode.
		const result = await runCli(
			["go", "--json", "https://github.com/example/project/pull/123"],
			{
				cwd: repoRoot,
				stdout: (chunk) => stdout.push(chunk),
			},
		);

		// Then it returns the existing destination without fetching or creating anything.
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(stdout.join(""))).toEqual({
			branch: "pr/123",
			path: worktreePath,
			repository: {
				name: basename(repoRoot),
				root: repoRoot,
			},
		});
	});

	it("resolves a same-repository GitLab merge request URL to an existing worktree", async () => {
		// Given a GitLab origin URL and an existing pr/123 worktree.
		const repoRoot = await createRepository();
		await runGit(repoRoot, [
			"remote",
			"add",
			"origin",
			"https://gitlab.com/example/project.git",
		]);
		const worktreePath = await addLinkedWorktree(repoRoot, "pr/123");
		const stdout: string[] = [];

		// When gji go --json receives the matching merge request URL.
		const result = await runCli(
			[
				"go",
				"--json",
				"https://gitlab.com/example/project/-/merge_requests/123",
			],
			{
				cwd: repoRoot,
				stdout: (chunk) => stdout.push(chunk),
			},
		);

		// Then it returns the existing merge request worktree.
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(stdout.join(""))).toEqual({
			branch: "pr/123",
			path: worktreePath,
			repository: {
				name: basename(repoRoot),
				root: repoRoot,
			},
		});
	});

	it("keeps JSON errors parseable when repository config emits warnings", async () => {
		// Given a repository config with an unknown key.
		const repoRoot = await createRepository();
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ unknownKey: true }),
			"utf8",
		);
		const stderr: string[] = [];

		// When gji go --json resolves an unknown branch.
		const result = await runCli(["go", "--json", "missing"], {
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
		});

		// Then stderr contains only the documented JSON error object.
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(stderr.join(""))).toMatchObject({
			error: expect.stringContaining("nothing matched"),
		});
	});

	it("serializes malformed repository config failures in JSON mode", async () => {
		// Given a repository with malformed local configuration.
		const repoRoot = await createRepository();
		await writeFile(join(repoRoot, ".gji.json"), "{ malformed", "utf8");
		const stderr: string[] = [];

		// When gji go --json needs to inspect the repository configuration.
		const result = await runCli(["go", "--json", "missing"], {
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
		});

		// Then it returns a structured configuration error instead of throwing raw text.
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(stderr.join(""))).toMatchObject({
			error: expect.stringContaining("could not load repository config"),
		});
	});

	it("skips deleted worktrees instead of returning a stale destination", async () => {
		// Given a linked worktree whose directory has been deleted.
		const repoRoot = await createRepository();
		const branchName = "feature/go-stale";
		const stalePath = await addLinkedWorktree(repoRoot, branchName);
		await rm(stalePath, { force: true, recursive: true });
		const stderr: string[] = [];

		// When gji go resolves the deleted worktree.
		const result = await createGoCommand()({
			branch: branchName,
			cwd: repoRoot,
			json: true,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it reports the branch as unlinked instead of returning the deleted path.
		expect(result).toBe(1);
		expect(stderr.join("")).toContain("exists but has no worktree");
		expect(stderr.join("")).not.toContain(stalePath);
	});

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

	it("starts go's chooser in the current repository and loads all repositories on toggle", async () => {
		// Given a current repository and a registered repository with another worktree.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		const configDir = await mkdtemp(join(tmpdir(), "gji-go-scope-"));
		process.env.GJI_CONFIG_DIR = configDir;
		const repoRoot = await createRepository();
		const currentPath = await addLinkedWorktree(
			repoRoot,
			"feature/go-scope-current",
		);
		const otherRoot = await createRepository();
		const otherPath = await addLinkedWorktree(
			otherRoot,
			"feature/go-scope-other",
		);
		await registerRepo(otherRoot);
		const stdout: string[] = [];

		try {
			const runGoCommand = createGoCommand({
				promptForWorktree: async (worktrees, scope) => {
					expect(worktrees.map((worktree) => worktree.path)).toContain(
						currentPath,
					);
					expect(worktrees.map((worktree) => worktree.path)).not.toContain(
						otherPath,
					);
					expect(scope?.label).toBe("current repository");
					const allRepositories = await scope?.toggle();
					expect(allRepositories?.label).toBe("all repositories");
					expect(allRepositories?.entries.map((entry) => entry.path)).toContain(
						otherPath,
					);
					return otherPath;
				},
			});

			// When gji go runs without a branch and the chooser toggles scope.
			const result = await runGoCommand({
				cwd: currentPath,
				stderr: () => undefined,
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it navigates to the selected worktree from the all-repositories scope.
			expect(result).toBe(0);
			expect(stdout.join("").trim()).toBe(otherPath);
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
		}
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
