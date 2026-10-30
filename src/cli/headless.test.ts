import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	addLinkedWorktree,
	createRepository,
	createRepositoryWithOrigin,
	pushPullRequestRef,
	runGit,
	spawnCli,
} from "../test-support/repository.js";
import { createCleanCommand } from "./commands/clean.js";
import { createGoCommand } from "./commands/go.js";
import { createNewCommand } from "./commands/new.js";

afterEach(() => {
	delete process.env.GJI_NO_TUI;
});

describe("isHeadless", () => {
	afterEach(() => {
		restoreStreamTty(process.stdin);
		restoreStreamTty(process.stdout);
	});

	it.each([
		{ stdin: true, stdout: true, noTui: "0", headless: false },
		{ stdin: true, stdout: false, noTui: "0", headless: true },
		{ stdin: false, stdout: true, noTui: "0", headless: true },
		{ stdin: false, stdout: false, noTui: "0", headless: true },
		{ stdin: true, stdout: true, noTui: "1", headless: true },
		{ stdin: true, stdout: true, noTui: "true", headless: false },
	])("is $headless with stdin terminal $stdin, stdout terminal $stdout, GJI_NO_TUI=$noTui", async ({
		stdin,
		stdout,
		noTui,
		headless,
	}) => {
		// Given the terminal state of stdin and stdout, and GJI_NO_TUI.
		setStreamTty(process.stdin, stdin);
		setStreamTty(process.stdout, stdout);
		process.env.GJI_NO_TUI = noTui;

		// When the real check runs.
		const { isHeadless } = await vi.importActual<
			typeof import("./runtime/headless.js")
		>("./runtime/headless.js");

		// Then prompts need both terminals, and only the exact value "1" disables them.
		expect(isHeadless()).toBe(headless);
	});
});

describe("headless mode (GJI_NO_TUI=1)", () => {
	describe("gji new", () => {
		it("errors immediately when no branch argument is given", async () => {
			// Given GJI_NO_TUI=1 is set and no branch argument is provided.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			const stderr: string[] = [];
			const runNewCommand = createNewCommand({
				promptForBranch: async () => {
					throw new Error("prompt must not be called in headless mode");
				},
			});

			// When gji new runs without a branch.
			const result = await runNewCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 with a clear error and never invokes the prompt.
			expect(result).toBe(1);
			expect(stderr.join("")).toMatch(/non-interactive|GJI_NO_TUI/i);
		});

		it("errors immediately when the target path already exists", async () => {
			// Given GJI_NO_TUI=1 is set and a branch that maps to an existing path.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			const branch = "feature/new-headless-conflict";
			await addLinkedWorktree(repoRoot, branch);
			const stderr: string[] = [];
			const runNewCommand = createNewCommand({
				promptForPathConflict: async () => {
					throw new Error(
						"conflict prompt must not be called in headless mode",
					);
				},
			});

			// When gji new runs with a branch whose worktree already exists.
			const result = await runNewCommand({
				branch,
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 with a clear error and never invokes the conflict prompt.
			expect(result).toBe(1);
			expect(stderr.join("")).toMatch(/non-interactive|GJI_NO_TUI/i);
		});
	});

	describe("gji go", () => {
		it("errors immediately when no branch argument is given", async () => {
			// Given GJI_NO_TUI=1 is set and no branch argument is provided.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			await addLinkedWorktree(repoRoot, "feature/go-headless");
			const stderr: string[] = [];
			const runGoCommand = createGoCommand({
				promptForWorktree: async () => {
					throw new Error("prompt must not be called in headless mode");
				},
			});

			// When gji go runs without a branch.
			const result = await runGoCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 with a clear error and never invokes the prompt.
			expect(result).toBe(1);
			expect(stderr.join("")).toMatch(/non-interactive|GJI_NO_TUI/i);
		});
	});

	describe("gji clean", () => {
		it("errors immediately when --force is absent", async () => {
			// Given GJI_NO_TUI=1 is set and --force is absent.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			await addLinkedWorktree(repoRoot, "feature/clean-headless");
			const stderr: string[] = [];
			const runCleanCommand = createCleanCommand({
				promptForWorktrees: async () => {
					throw new Error("prompt must not be called in headless mode");
				},
			});

			// When gji clean runs without --force in headless mode.
			const result = await runCleanCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 with a clear error and never invokes the prompt.
			expect(result).toBe(1);
			expect(stderr.join("")).toMatch(/non-interactive|GJI_NO_TUI/i);
		});

		it("removes all candidates without prompting when --force is given", async () => {
			// Given GJI_NO_TUI=1 is set and --force is provided.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			await addLinkedWorktree(repoRoot, "feature/clean-force-headless");
			const stdout: string[] = [];
			const runCleanCommand = createCleanCommand({
				promptForWorktrees: async () => {
					throw new Error("prompt must not be called when --force is set");
				},
			});

			// When gji clean --force runs in headless mode.
			const result = await runCleanCommand({
				cwd: repoRoot,
				force: true,
				stderr: () => undefined,
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it succeeds and removed all linked worktrees without prompting.
			expect(result).toBe(0);
			expect(stdout.join("")).toContain(repoRoot);
		});
	});
});

describe("without a terminal", () => {
	it("fails gji new with no branch and creates nothing", async () => {
		// Given a repository and a CLI process without a terminal.
		const repoRoot = await createRepository();
		const worktreesBefore = await runGit(repoRoot, ["worktree", "list"]);

		// When gji new runs with no branch.
		const result = await spawnCli(repoRoot, ["new"]);

		// Then it exits non-zero, explains the missing branch, and creates nothing.
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("branch argument is required");
		expect(await runGit(repoRoot, ["worktree", "list"])).toBe(worktreesBefore);
	});

	it("reports the missing gji new branch as a JSON error with --json", async () => {
		// Given a repository and a CLI process without a terminal.
		const repoRoot = await createRepository();

		// When gji new --json runs with no branch.
		const result = await spawnCli(repoRoot, ["new", "--json"]);

		// Then stderr holds the JSON error form and stdout stays empty.
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(JSON.parse(result.stderr)).toEqual({
			error: "branch argument is required",
		});
	});

	it.each([
		{ args: ["go"], names: "branch argument" },
		{ args: ["clean"], names: "--force" },
	])("names what to pass instead for gji $args", async ({ args, names }) => {
		// Given a repository with a linked worktree the command could choose.
		const repoRoot = await createRepository();
		await addLinkedWorktree(repoRoot, "feature/no-terminal");

		// When the prompting command runs without a terminal.
		const result = await spawnCli(repoRoot, args);

		// Then it exits non-zero and says what to pass instead of a bare Aborted.
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(names);
		expect(result.stderr).not.toMatch(/^Aborted/m);
	});

	it("points gji go at gji new for a local branch without a worktree", async () => {
		// Given a local branch with no worktree.
		const repoRoot = await createRepository();
		await runGit(repoRoot, ["branch", "feature/no-worktree"]);

		// When gji go targets that branch without a terminal.
		const result = await spawnCli(repoRoot, ["go", "feature/no-worktree"]);

		// Then it fails and names the command that works without a terminal.
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("gji new feature/no-worktree");
	});

	it("names a Git command when branchPrefix would make gji new pick another branch", async () => {
		// Given a branchPrefix, so gji new would create a differently named branch.
		const repoRoot = await createRepository();
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ branchPrefix: "team/" }),
			"utf8",
		);
		await runGit(repoRoot, ["branch", "other"]);

		// When gji go targets the unprefixed local branch without a terminal.
		const result = await spawnCli(repoRoot, ["go", "other"]);

		// Then it names a command that uses that branch.
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("git worktree add <path> other");
		expect(result.stderr).not.toContain("gji new");
	});

	it("names a tracking Git command for a remote-only branch", async () => {
		// Given a branch that exists only on origin.
		const { repoRoot } = await createRepositoryWithOrigin();
		await runGit(repoRoot, ["push", "origin", "HEAD:refs/heads/remote-only"]);
		await runGit(repoRoot, ["fetch", "origin"]);

		// When gji go targets it without a terminal.
		const result = await spawnCli(repoRoot, ["go", "remote-only"]);

		// Then it names the command that creates a tracking branch.
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"git worktree add --track -b remote-only <path> origin/remote-only",
		);
	});

	it("creates a PR worktree through gji go with GJI_NO_TUI=1", async () => {
		// Given an origin that publishes a pull request ref.
		const { repoRoot } = await createRepositoryWithOrigin();
		await pushPullRequestRef(repoRoot, "42");
		process.env.GJI_NO_TUI = "1";

		// When gji go targets the PR, which needs no prompt.
		const result = await spawnCli(repoRoot, ["go", "#42"]);

		// Then the worktree is created.
		expect(result.exitCode).toBe(0);
		expect(await runGit(repoRoot, ["branch", "--list", "pr/42"])).toContain(
			"pr/42",
		);
	});
});

// Force TTY detection so the real check sees a terminal state.
function setStreamTty(
	stream: NodeJS.ReadStream | NodeJS.WriteStream,
	value: boolean,
): void {
	Object.defineProperty(stream, "isTTY", {
		configurable: true,
		value,
		writable: true,
	});
}

function restoreStreamTty(
	stream: NodeJS.ReadStream | NodeJS.WriteStream,
): void {
	delete (stream as { isTTY?: boolean }).isTTY;
}
