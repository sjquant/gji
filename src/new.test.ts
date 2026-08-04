import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { GLOBAL_CONFIG_FILE_PATH } from "./config.js";
import {
	createNewCommand,
	generateBranchPlaceholder,
	runNewCommand,
} from "./new.js";
import { resolveWorktreePath } from "./repo.js";
import {
	addLinkedWorktree,
	cloneRepository,
	commitFile,
	createRepository,
	createRepositoryWithOrigin,
	currentBranch,
	pathExists,
	runGit,
} from "./repo.test-helpers.js";

const originalHome = process.env.HOME;
const originalConfigDir = process.env.GJI_CONFIG_DIR;
const originalHeadless = process.env.GJI_NO_TUI;

afterEach(() => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else process.env.HOME = originalHome;
	if (originalConfigDir === undefined) delete process.env.GJI_CONFIG_DIR;
	else process.env.GJI_CONFIG_DIR = originalConfigDir;
	if (originalHeadless === undefined) delete process.env.GJI_NO_TUI;
	else process.env.GJI_NO_TUI = originalHeadless;
});

describe("gji new", () => {
	it("creates a new branch from the freshly fetched remote default branch", async () => {
		// Given a repository whose remote default branch advanced beyond its local checkout.
		const { originRoot, repoRoot } = await createRepositoryWithOrigin();
		const remoteClone = await cloneRepository(originRoot);
		await commitFile(
			remoteClone,
			"remote-only.txt",
			"from remote\n",
			"Advance remote default branch",
		);
		await runGit(remoteClone, ["push", "origin", "HEAD"]);
		const newWorktreePath = resolveWorktreePath(repoRoot, "feature/fresh-base");

		// When gji creates a normal new worktree.
		const result = await runCli(["new", "feature/fresh-base"], {
			cwd: repoRoot,
		});

		// Then the new branch contains the latest remote commit.
		expect(result.exitCode).toBe(0);
		await expect(
			pathExists(join(newWorktreePath, "remote-only.txt")),
		).resolves.toBe(true);
	});

	it("skips the remote refresh when --no-fetch is provided", async () => {
		// Given a repository whose remote default branch advanced beyond its local checkout.
		const { originRoot, repoRoot } = await createRepositoryWithOrigin();
		const remoteClone = await cloneRepository(originRoot);
		await commitFile(
			remoteClone,
			"remote-only.txt",
			"from remote\n",
			"Advance remote default branch",
		);
		await runGit(remoteClone, ["push", "origin", "HEAD"]);
		const newWorktreePath = resolveWorktreePath(repoRoot, "feature/local-base");

		// When gji creates a new worktree with fetching disabled.
		const result = await runCli(["new", "--no-fetch", "feature/local-base"], {
			cwd: repoRoot,
		});

		// Then the new branch retains the previous local HEAD behavior.
		expect(result.exitCode).toBe(0);
		await expect(
			pathExists(join(newWorktreePath, "remote-only.txt")),
		).resolves.toBe(false);
	});

	it("asks whether to abort when refreshing the remote base fails", async () => {
		// Given a repository with an unreachable configured remote.
		const repoRoot = await createRepositoryWithOrigin().then(
			({ repoRoot }) => repoRoot,
		);
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ syncRemote: "origin" }),
			"utf8",
		);
		await runGit(repoRoot, [
			"remote",
			"set-url",
			"origin",
			"/missing/origin.git",
		]);
		const stderr: string[] = [];
		let prompted = false;
		const runNew = createNewCommand({
			promptForFetchFailure: async () => {
				prompted = true;
				return false;
			},
		});

		// When gji new cannot refresh the configured remote.
		const result = await runNew({
			branch: "feature/abort-stale-base",
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it asks for confirmation and aborts without creating a worktree.
		expect(result).toBe(1);
		expect(prompted).toBe(true);
		expect(stderr.join("")).toContain("Aborted");
		await expect(
			pathExists(resolveWorktreePath(repoRoot, "feature/abort-stale-base")),
		).resolves.toBe(false);
	});

	it("continues from the cached remote base after a failed refresh", async () => {
		// Given a configured remote with a cached tracking ref that cannot be fetched.
		const { originRoot, repoRoot } = await createRepositoryWithOrigin();
		const baseBranch = await currentBranch(repoRoot);
		const remoteClone = await cloneRepository(originRoot);
		await commitFile(
			remoteClone,
			"cached-only.txt",
			"from cached remote\n",
			"Advance cached remote base",
		);
		await runGit(remoteClone, ["push", "origin", "HEAD"]);
		await runGit(repoRoot, ["fetch", "origin", baseBranch]);
		await runGit(repoRoot, ["remote", "set-head", "origin", "--auto"]);
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ syncRemote: "origin" }),
			"utf8",
		);
		await runGit(repoRoot, [
			"remote",
			"set-url",
			"origin",
			"/missing/origin.git",
		]);
		const stderr: string[] = [];
		const runNew = createNewCommand({
			promptForFetchFailure: async () => true,
		});

		// When gji new continues after the failed refresh.
		const result = await runNew({
			branch: "feature/cached-base",
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it creates the branch from the cached remote tracking ref.
		expect(result).toBe(0);
		expect(stderr.join("")).toContain("Continuing with the cached origin/");
		await expect(
			pathExists(
				join(
					resolveWorktreePath(repoRoot, "feature/cached-base"),
					"cached-only.txt",
				),
			),
		).resolves.toBe(true);
	});

	it("continues from local HEAD when no cached remote base exists", async () => {
		// Given a configured remote with no cached tracking ref and an unreachable URL.
		const repoRoot = await createRepositoryWithOrigin().then(
			({ repoRoot }) => repoRoot,
		);
		const baseBranch = await currentBranch(repoRoot);
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ syncRemote: "origin", syncDefaultBranch: baseBranch }),
			"utf8",
		);
		await runGit(repoRoot, [
			"remote",
			"set-url",
			"origin",
			"/missing/origin.git",
		]);
		await runGit(repoRoot, [
			"update-ref",
			"-d",
			`refs/remotes/origin/${baseBranch}`,
		]);
		await commitFile(
			repoRoot,
			"local-head-only.txt",
			"from local HEAD\n",
			"Advance local HEAD",
		);
		const stderr: string[] = [];
		const runNew = createNewCommand({
			promptForFetchFailure: async () => true,
		});

		// When gji new continues after the failed refresh.
		const result = await runNew({
			branch: "feature/local-head-fallback",
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it creates the branch from local HEAD and reports that fallback.
		expect(result).toBe(0);
		expect(stderr.join("")).toContain(
			"Continuing from the local repository HEAD.",
		);
		await expect(
			pathExists(
				join(
					resolveWorktreePath(repoRoot, "feature/local-head-fallback"),
					"local-head-only.txt",
				),
			),
		).resolves.toBe(true);
	});

	it("fails with structured JSON when the remote refresh fails", async () => {
		// Given a configured remote with an unreachable URL.
		const repoRoot = await createRepositoryWithOrigin().then(
			({ repoRoot }) => repoRoot,
		);
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ syncRemote: "origin" }),
			"utf8",
		);
		await runGit(repoRoot, [
			"remote",
			"set-url",
			"origin",
			"/missing/origin.git",
		]);
		const stderr: string[] = [];
		const runNew = createNewCommand({
			promptForFetchFailure: async () => {
				throw new Error("prompt should not run in JSON mode");
			},
		});

		// When gji new runs in JSON mode.
		const result = await runNew({
			branch: "feature/json-fetch-failure",
			cwd: repoRoot,
			json: true,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it exits without creating a worktree and emits structured error JSON.
		expect(result).toBe(1);
		expect(JSON.parse(stderr.join(""))).toMatchObject({
			error: expect.stringContaining("Could not refresh"),
		});
		await expect(
			pathExists(resolveWorktreePath(repoRoot, "feature/json-fetch-failure")),
		).resolves.toBe(false);
	});

	it("fails without prompting in headless mode when the remote refresh fails", async () => {
		// Given a configured remote with an unreachable URL and headless mode enabled.
		const repoRoot = await createRepositoryWithOrigin().then(
			({ repoRoot }) => repoRoot,
		);
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ syncRemote: "origin" }),
			"utf8",
		);
		await runGit(repoRoot, [
			"remote",
			"set-url",
			"origin",
			"/missing/origin.git",
		]);
		process.env.GJI_NO_TUI = "1";
		const stderr: string[] = [];
		const runNew = createNewCommand({
			promptForFetchFailure: async () => {
				throw new Error("prompt should not run in headless mode");
			},
		});

		// When gji new runs in headless mode.
		const result = await runNew({
			branch: "feature/headless-fetch-failure",
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it exits with a clear error and does not create a worktree.
		expect(result).toBe(1);
		expect(stderr.join("")).toContain("Could not refresh");
		await expect(
			pathExists(
				resolveWorktreePath(repoRoot, "feature/headless-fetch-failure"),
			),
		).resolves.toBe(false);
	});

	it("uses configured remote and default branch when refreshing the base", async () => {
		// Given a repository with a configured non-default remote and base branch.
		const { originRoot, repoRoot } = await createRepositoryWithOrigin();
		const baseBranch = await currentBranch(repoRoot);
		await runGit(repoRoot, ["remote", "add", "upstream", originRoot]);
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ syncRemote: "upstream", syncDefaultBranch: baseBranch }),
			"utf8",
		);
		const remoteClone = await cloneRepository(originRoot);
		await commitFile(
			remoteClone,
			"configured-base.txt",
			"from configured base\n",
			"Advance configured base branch",
		);
		await runGit(remoteClone, ["push", "origin", "HEAD"]);

		// When gji new creates a branch with the configured remote base.
		const result = await runCli(["new", "feature/configured-base"], {
			cwd: repoRoot,
		});

		// Then it starts from the configured remote branch.
		expect(result.exitCode).toBe(0);
		await expect(
			pathExists(
				join(
					resolveWorktreePath(repoRoot, "feature/configured-base"),
					"configured-base.txt",
				),
			),
		).resolves.toBe(true);
	});

	it("creates a branch and linked worktree from the repository root", async () => {
		// Given a repository root and a new branch name.
		const repoRoot = await createRepository();
		const stdout: string[] = [];
		const branchName = "feature/add-command";
		const worktreePath = resolveWorktreePath(repoRoot, branchName);

		// When gji creates a new worktree for that branch.
		const result = await runCli(["new", branchName], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the branch and worktree exist at the deterministic path.
		expect(result.exitCode).toBe(0);
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(currentBranch(worktreePath)).resolves.toBe(branchName);
		expect(stdout.join("")).toBe(`${worktreePath}\n`);
	});

	it("creates a detached linked worktree without creating a branch", async () => {
		// Given a repository root and a detached worktree name.
		const repoRoot = await createRepository();
		const stdout: string[] = [];
		const worktreeName = "detached/scratch-pad";
		const worktreePath = resolveWorktreePath(repoRoot, worktreeName);

		// When gji creates a detached worktree for that name.
		const result = await runCli(["new", "--detached", worktreeName], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the detached worktree exists at the deterministic path without a branch.
		expect(result.exitCode).toBe(0);
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(currentBranch(worktreePath)).resolves.toBe("");
		await expect(
			runGit(repoRoot, [
				"show-ref",
				"--verify",
				"--quiet",
				`refs/heads/${worktreeName}`,
			]),
		).rejects.toThrow();
		expect(stdout.join("")).toBe(`${worktreePath}\n`);
	});

	it("creates the branch from the main repository even when run inside a worktree", async () => {
		// Given an existing linked worktree and a second branch to create.
		const repoRoot = await createRepository();
		const existingBranch = "feature/existing";
		const existingWorktreePath = await addLinkedWorktree(
			repoRoot,
			existingBranch,
		);
		const newBranch = "feature/from-worktree";
		const newWorktreePath = resolveWorktreePath(repoRoot, newBranch);
		const nestedCwd = join(existingWorktreePath, "nested");
		await mkdir(nestedCwd, { recursive: true });

		// When gji new runs from inside that linked worktree.
		const result = await runCli(["new", newBranch], {
			cwd: nestedCwd,
		});

		// Then it still creates the new branch/worktree from the main repository.
		expect(result.exitCode).toBe(0);
		await expect(pathExists(newWorktreePath)).resolves.toBe(true);
		await expect(currentBranch(newWorktreePath)).resolves.toBe(newBranch);
	});

	it("rejects --from-current when creating a detached worktree", async () => {
		// Given a detached-worktree request with the branch-base option.
		const stderr: string[] = [];

		// When gji new receives incompatible options.
		const result = await runCli(["new", "--detached", "--from-current"], {
			cwd: "/not-a-repository",
			stderr: (chunk) => stderr.push(chunk),
		});

		// Then it reports the conflict without trying to create a worktree.
		expect(result.exitCode).toBe(1);
		expect(stderr.join("")).toBe(
			"gji new: --from-current cannot be used with --detached\n",
		);
	});

	it("creates the branch from the current worktree when requested", async () => {
		// Given a linked worktree with a commit that is not in the main worktree.
		const repoRoot = await createRepository();
		const currentBranchName = "feature/current-base";
		const currentWorktreePath = await addLinkedWorktree(
			repoRoot,
			currentBranchName,
		);
		await commitFile(
			currentWorktreePath,
			"current-only.txt",
			"from current worktree\n",
			"Add current-worktree change",
		);
		const newBranch = "feature/from-current-worktree";
		const newWorktreePath = resolveWorktreePath(repoRoot, newBranch);

		// When gji new --from-current runs from that linked worktree.
		const result = await runCli(["new", "--from-current", newBranch], {
			cwd: currentWorktreePath,
		});

		// Then the new branch contains the current worktree's commit.
		expect(result.exitCode).toBe(0);
		await expect(
			pathExists(join(newWorktreePath, "current-only.txt")),
		).resolves.toBe(true);
		await expect(currentBranch(newWorktreePath)).resolves.toBe(newBranch);
	});

	it("takes changes onto the current worktree commit when requested", async () => {
		// Given a linked worktree with a divergent commit and an uncommitted change.
		const repoRoot = await createRepository();
		const currentWorktreePath = await addLinkedWorktree(
			repoRoot,
			"feature/take-current-base",
		);
		await commitFile(
			currentWorktreePath,
			"current-only.txt",
			"committed in current worktree\n",
			"Add current-only commit",
		);
		await writeFile(
			join(currentWorktreePath, "taken.txt"),
			"taken from current worktree\n",
			"utf8",
		);
		const newBranch = "feature/take-from-current";
		const newWorktreePath = resolveWorktreePath(repoRoot, newBranch);
		const stderr: string[] = [];

		// When gji new --take --from-current runs in that linked worktree.
		const result = await runCli(
			["new", "--take", "--from-current", newBranch],
			{
				cwd: currentWorktreePath,
				stderr: (chunk) => stderr.push(chunk),
			},
		);

		// Then the target contains both the divergent commit and the transferred change.
		expect(result.exitCode).toBe(0);
		await expect(
			pathExists(join(newWorktreePath, "current-only.txt")),
		).resolves.toBe(true);
		await expect(pathExists(join(newWorktreePath, "taken.txt"))).resolves.toBe(
			true,
		);
		await expect(
			pathExists(join(currentWorktreePath, "taken.txt")),
		).resolves.toBe(false);
		expect(stderr.join("")).toContain("✓ took 1 changed file (1 untracked)");
	});

	it("lists files and ignored-file limitations in take dry-runs", async () => {
		// Given modified and untracked files in the current worktree.
		const repoRoot = await createRepository();
		await writeFile(join(repoRoot, "README.md"), "changed\n", "utf8");
		await writeFile(join(repoRoot, "untracked.txt"), "untracked\n", "utf8");
		const stdout: string[] = [];

		// When gji new --take --dry-run runs.
		const result = await runCli(
			["new", "--take", "--dry-run", "feature/take-dry"],
			{
				cwd: repoRoot,
				stdout: (chunk) => stdout.push(chunk),
			},
		);

		// Then it lists the files without creating a worktree.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toContain("README.md");
		expect(stdout.join("")).toContain("untracked.txt");
		await expect(
			pathExists(resolveWorktreePath(repoRoot, "feature/take-dry")),
		).resolves.toBe(false);
	});

	it("restores the source changes when applying a take stash fails", async () => {
		// Given an existing branch whose target contains a conflicting tracked file.
		const repoRoot = await createRepository();
		const targetBranch = "feature/take-conflict";
		await runGit(repoRoot, ["branch", targetBranch]);
		await commitFile(
			repoRoot,
			"conflict.txt",
			"target content\n",
			"Add target conflict",
		);
		await runGit(repoRoot, ["branch", "-f", targetBranch, "HEAD"]);
		await runGit(repoRoot, ["reset", "--hard", "HEAD~1"]);
		await writeFile(join(repoRoot, "conflict.txt"), "source content\n", "utf8");
		const stderr: string[] = [];

		// When gji new --take attempts to apply the conflicting stash.
		const result = await runCli(["new", "--take", targetBranch], {
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
		});

		// Then creation fails safely and the source file remains available.
		expect(result.exitCode).toBe(1);
		expect(stderr.join("")).toContain("changes are safe in stash");
		expect(await readFile(join(repoRoot, "conflict.txt"), "utf8")).toBe(
			"source content\n",
		);
	});

	it("copies taken changes while leaving the source worktree unchanged", async () => {
		// Given an uncommitted file in the source worktree.
		const repoRoot = await createRepository();
		await writeFile(join(repoRoot, "copied.txt"), "copy me\n", "utf8");
		const branch = "feature/take-copy";
		const targetPath = resolveWorktreePath(repoRoot, branch);

		// When gji new --take --copy runs.
		const result = await runCli(["new", "--take", "--copy", branch], {
			cwd: repoRoot,
		});

		// Then both source and target contain the copied file.
		expect(result.exitCode).toBe(0);
		await expect(readFile(join(repoRoot, "copied.txt"), "utf8")).resolves.toBe(
			"copy me\n",
		);
		await expect(
			readFile(join(targetPath, "copied.txt"), "utf8"),
		).resolves.toBe("copy me\n");
	});

	it("writes the created worktree path to the shell output file without printing it", async () => {
		// Given a repository root and a shell output file.
		const repoRoot = await createRepository();
		const branchName = "feature/new-output-file";
		const worktreePath = resolveWorktreePath(repoRoot, branchName);
		const outputFile = join(repoRoot, "created-worktree.txt");
		const originalOutputFile = process.env.GJI_NEW_OUTPUT_FILE;
		const stdout: string[] = [];

		process.env.GJI_NEW_OUTPUT_FILE = outputFile;

		try {
			// When gji new runs via the shell-wrapper output file path.
			const result = await runNewCommand({
				branch: branchName,
				cwd: repoRoot,
				stderr: () => undefined,
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it writes the created path to the output file instead of stdout.
			expect(result).toBe(0);
			expect(stdout).toEqual([]);
			await expect(pathExists(worktreePath)).resolves.toBe(true);
			await expect(pathExists(outputFile)).resolves.toBe(true);
			await expect(readFile(outputFile, "utf8")).resolves.toBe(
				`${worktreePath}\n`,
			);
		} finally {
			if (originalOutputFile === undefined) {
				delete process.env.GJI_NEW_OUTPUT_FILE;
			} else {
				process.env.GJI_NEW_OUTPUT_FILE = originalOutputFile;
			}
		}
	});

	it("applies a global branch prefix when creating a new worktree", async () => {
		// Given an isolated home directory with a configured default branch prefix.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const stdout: string[] = [];
		const branchName = "add-command";
		const prefixedBranchName = `feature/${branchName}`;
		const worktreePath = resolveWorktreePath(repoRoot, prefixedBranchName);
		const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
		process.env.HOME = home;

		await mkdir(dirname(globalConfigPath), { recursive: true });
		await writeFile(
			globalConfigPath,
			JSON.stringify({ branchPrefix: "feature/" }),
			"utf8",
		);

		// When gji new creates a worktree for an unprefixed branch name.
		const result = await runCli(["new", branchName], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it creates the prefixed branch/worktree from the configured default.
		expect(result.exitCode).toBe(0);
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(currentBranch(worktreePath)).resolves.toBe(prefixedBranchName);
		expect(stdout.join("")).toBe(`${worktreePath}\n`);
	});

	it("prefers a repo-local branch prefix over the global default", async () => {
		// Given global and repo-local branch prefix defaults.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const branchName = "add-command";
		const prefixedBranchName = `repo/${branchName}`;
		const worktreePath = resolveWorktreePath(repoRoot, prefixedBranchName);
		const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
		process.env.HOME = home;

		await mkdir(dirname(globalConfigPath), { recursive: true });
		await writeFile(
			globalConfigPath,
			JSON.stringify({ branchPrefix: "feature/" }),
			"utf8",
		);
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ branchPrefix: "repo/" }),
			"utf8",
		);

		// When gji new runs inside that repository.
		const result = await runCli(["new", branchName], {
			cwd: repoRoot,
		});

		// Then the repo-local prefix wins over the global default.
		expect(result.exitCode).toBe(0);
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(currentBranch(worktreePath)).resolves.toBe(prefixedBranchName);
	});

	it("prompts for a branch name with a funny placeholder when none is provided", async () => {
		// Given a repository root and an interactive branch prompt.
		const repoRoot = await createRepository();
		const chosenBranch = "prometheus-brought-snacks";
		const worktreePath = resolveWorktreePath(repoRoot, chosenBranch);
		const stdout: string[] = [];
		const runNewCommand = createNewCommand({
			createBranchPlaceholder: () => "socrates-debugged-this",
			promptForBranch: async (placeholder) => {
				expect(placeholder).toBe("socrates-debugged-this");
				return chosenBranch;
			},
		});

		// When gji new runs without an explicit branch.
		const result = await runNewCommand({
			cwd: repoRoot,
			stderr: () => undefined,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it creates the prompted branch/worktree and prints the path.
		expect(result).toBe(0);
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(currentBranch(worktreePath)).resolves.toBe(chosenBranch);
		expect(stdout.join("")).toBe(`${worktreePath}\n`);
	});

	it("uses the generated placeholder for detached worktrees without prompting", async () => {
		// Given a repository root and a detached command without an explicit name.
		const repoRoot = await createRepository();
		const generatedName = "prometheus-brought-snacks";
		const worktreePath = resolveWorktreePath(repoRoot, generatedName);
		const stdout: string[] = [];
		let promptCalled = false;
		const runNewCommand = createNewCommand({
			createBranchPlaceholder: () => generatedName,
			promptForBranch: async () => {
				promptCalled = true;
				return "should-not-run";
			},
		});

		// When gji new runs in detached mode without an explicit name.
		const result = await runNewCommand({
			cwd: repoRoot,
			detached: true,
			stderr: () => undefined,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it succeeds without trying to prompt and uses the generated name.
		expect(result).toBe(0);
		expect(promptCalled).toBe(false);
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(currentBranch(worktreePath)).resolves.toBe("");
		expect(stdout.join("")).toBe(`${worktreePath}\n`);
	});

	it("retries detached placeholder names with a suffix when the generated path already exists", async () => {
		// Given a repository root and an auto-generated detached name that already exists.
		const repoRoot = await createRepository();
		const generatedName = "prometheus-brought-snacks";
		const conflictingPath = resolveWorktreePath(repoRoot, generatedName);
		const retriedPath = resolveWorktreePath(repoRoot, `${generatedName}-2`);
		const stdout: string[] = [];
		let promptCalled = false;
		const runNewCommand = createNewCommand({
			createBranchPlaceholder: () => generatedName,
			promptForBranch: async () => {
				promptCalled = true;
				return "should-not-run";
			},
		});

		await mkdir(conflictingPath, { recursive: true });

		// When gji new runs in detached mode without an explicit name.
		const result = await runNewCommand({
			cwd: repoRoot,
			detached: true,
			stderr: () => undefined,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it retries with a suffixed name instead of failing or prompting.
		expect(result).toBe(0);
		expect(promptCalled).toBe(false);
		await expect(pathExists(retriedPath)).resolves.toBe(true);
		await expect(currentBranch(retriedPath)).resolves.toBe("");
		expect(stdout.join("")).toBe(`${retriedPath}\n`);
	});

	it("aborts when the branch prompt is cancelled", async () => {
		// Given a repository root and a cancelled branch prompt.
		const repoRoot = await createRepository();
		const stderr: string[] = [];
		const runNewCommand = createNewCommand({
			createBranchPlaceholder: () => "socrates-debugged-this",
			promptForBranch: async () => null,
		});

		// When gji new runs without an explicit branch and the prompt is cancelled.
		const result = await runNewCommand({
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it aborts without creating a worktree.
		expect(result).toBe(1);
		expect(stderr.join("")).toBe("Aborted\n");
	});

	it("reuses the existing path when the conflict prompt selects reuse", async () => {
		// Given an existing target path for the requested branch.
		const repoRoot = await createRepository();
		const stdout: string[] = [];
		const stderr: string[] = [];
		const branchName = "feature/existing-path";
		const worktreePath = resolveWorktreePath(repoRoot, branchName);
		const runNewCommand = createNewCommand({
			promptForPathConflict: async () => "reuse",
		});

		await mkdir(worktreePath, { recursive: true });

		// When the interactive conflict handler selects reuse.
		const result = await runNewCommand({
			branch: branchName,
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the command exits successfully and returns the existing path.
		expect(result).toBe(0);
		expect(stderr).toEqual([]);
		expect(stdout.join("")).toBe(`${worktreePath}\n`);
	});

	it("aborts when the conflict prompt selects abort", async () => {
		// Given an existing target path for the requested branch.
		const repoRoot = await createRepository();
		const stdout: string[] = [];
		const stderr: string[] = [];
		const branchName = "feature/abort-existing-path";
		const worktreePath = resolveWorktreePath(repoRoot, branchName);
		const runNewCommand = createNewCommand({
			promptForPathConflict: async () => "abort",
		});

		await mkdir(worktreePath, { recursive: true });

		// When the interactive conflict handler selects abort.
		const result = await runNewCommand({
			branch: branchName,
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the command exits without creating or reusing the worktree.
		expect(result).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr.join("")).toBe(
			`Aborted because target worktree path already exists: ${worktreePath}\n`,
		);
	});

	it("removes and recreates the worktree when --force is used and path already exists", async () => {
		// Given an existing worktree for a branch.
		const repoRoot = await createRepository();
		const branchName = "feature/force-recreate";
		const worktreePath = await addLinkedWorktree(repoRoot, branchName);
		const stdout: string[] = [];
		const stderr: string[] = [];

		// When gji new --force runs for that same branch.
		const result = await runCli(["new", "--force", branchName], {
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it removes and recreates the worktree without prompting.
		expect(result.exitCode).toBe(0);
		expect(stderr).toEqual([]);
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(currentBranch(worktreePath)).resolves.toBe(branchName);
		expect(stdout.join("")).toBe(`${worktreePath}\n`);
	});

	it("creates a linked worktree for a branch that already exists locally", async () => {
		// Given a repository with a local branch that has no worktree checked out yet.
		const repoRoot = await createRepository();
		const stdout: string[] = [];
		const branchName = "feature/pre-existing-branch";
		const worktreePath = resolveWorktreePath(repoRoot, branchName);
		await runGit(repoRoot, ["branch", branchName]);

		// When gji new is run for that pre-existing branch.
		const result = await runCli(["new", branchName], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the worktree is created at the expected path and is checked out to the existing branch.
		expect(result.exitCode).toBe(0);
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(currentBranch(worktreePath)).resolves.toBe(branchName);
		expect(stdout.join("")).toBe(`${worktreePath}\n`);
	});

	describe("syncFiles integration", () => {
		it("copies a configured sync file into the new worktree end-to-end", async () => {
			// Given a repo with a source file and syncFiles config.
			const repoRoot = await createRepository();
			const branchName = "feature/sync-copy";
			const worktreePath = resolveWorktreePath(repoRoot, branchName);
			await writeFile(join(repoRoot, ".env.example"), "SECRET=\n", "utf8");
			await writeFile(
				join(repoRoot, ".gji.json"),
				JSON.stringify({ syncFiles: [".env.example"] }),
				"utf8",
			);

			// When creating the worktree.
			const result = await runCli(["new", branchName], { cwd: repoRoot });

			// Then the file is present in the new worktree.
			expect(result.exitCode).toBe(0);
			const content = await readFile(
				join(worktreePath, ".env.example"),
				"utf8",
			);
			expect(content).toBe("SECRET=\n");
		});

		it("skips a sync file whose source does not exist without aborting", async () => {
			// Given a repo with syncFiles pointing to a missing source.
			const repoRoot = await createRepository();
			const branchName = "feature/sync-missing";
			const worktreePath = resolveWorktreePath(repoRoot, branchName);
			await writeFile(
				join(repoRoot, ".gji.json"),
				JSON.stringify({ syncFiles: ["missing.txt"] }),
				"utf8",
			);
			const stderr: string[] = [];

			// When creating the worktree.
			const result = await runNewCommand({
				branch: branchName,
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it succeeds, no copy was attempted, and no warning was emitted.
			expect(result).toBe(0);
			expect(stderr).toEqual([]);
			await expect(pathExists(join(worktreePath, "missing.txt"))).resolves.toBe(
				false,
			);
		});

		it("fails closed when an invalid sync pattern prevents dependency setup", async () => {
			// Given a repo with an absolute-path pattern in syncFiles (which syncFiles rejects).
			const repoRoot = await createRepository();
			const branchName = "feature/sync-invalid";
			const worktreePath = resolveWorktreePath(repoRoot, branchName);
			await writeFile(
				join(repoRoot, ".gji.json"),
				JSON.stringify({
					syncFiles: ["/etc/passwd"],
					hooks: { "after-create": "touch after-create-ran" },
				}),
				"utf8",
			);
			const stderr: string[] = [];

			// When creating the worktree.
			const result = await runNewCommand({
				branch: branchName,
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then the worktree is created but setup stops before install or after-create.
			expect(result).toBe(1);
			await expect(pathExists(worktreePath)).resolves.toBe(true);
			expect(stderr.join("")).toContain("Warning:");
			expect(stderr.join("")).toContain("/etc/passwd");
			await expect(
				pathExists(join(worktreePath, "after-create-ran")),
			).resolves.toBe(false);
		});

		it("reports sync-file failures as structured JSON errors", async () => {
			// Given a repository with an invalid syncFiles pattern and JSON output enabled.
			const repoRoot = await createRepository();
			await writeFile(
				join(repoRoot, ".gji.json"),
				JSON.stringify({ syncFiles: ["/etc/passwd"] }),
				"utf8",
			);
			const stderr: string[] = [];

			// When worktree creation stops at the sync-file stage.
			const result = await createNewCommand()({
				branch: "feature/sync-failure-json",
				cwd: repoRoot,
				json: true,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then the JSON error identifies the sync-file failure and no bootstrap result.
			expect(result).toBe(1);
			expect(JSON.parse(stderr.join(""))).toMatchObject({
				error: "worktree bootstrap failed",
				syncFiles: [{ adapter: "syncFiles", state: "failed" }],
			});
		});

		it("local syncFiles config overrides global (no array merging)", async () => {
			// Given global config with syncFiles and local config with a different syncFiles.
			const home = await mkdtemp(join(tmpdir(), "gji-home-"));
			const repoRoot = await createRepository();
			const branchName = "feature/sync-override";
			const worktreePath = resolveWorktreePath(repoRoot, branchName);
			const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
			process.env.HOME = home;

			await writeFile(
				join(repoRoot, "global-file.txt"),
				"from global\n",
				"utf8",
			);
			await writeFile(join(repoRoot, "local-file.txt"), "from local\n", "utf8");
			await mkdir(dirname(globalConfigPath), { recursive: true });
			await writeFile(
				globalConfigPath,
				JSON.stringify({ syncFiles: ["global-file.txt"] }),
				"utf8",
			);
			await writeFile(
				join(repoRoot, ".gji.json"),
				JSON.stringify({ syncFiles: ["local-file.txt"] }),
				"utf8",
			);

			// When creating the worktree.
			const result = await runCli(["new", branchName], { cwd: repoRoot });

			// Then only the local syncFiles list is used (local-file.txt copied, global-file.txt not).
			expect(result.exitCode).toBe(0);
			await expect(
				pathExists(join(worktreePath, "local-file.txt")),
			).resolves.toBe(true);
			await expect(
				pathExists(join(worktreePath, "global-file.txt")),
			).resolves.toBe(false);
		});
	});

	it("automatically installs supported dependencies without prompting", async () => {
		// Given a repository with a pnpm lockfile and no dependency policy config.
		const repoRoot = await createRepository();
		await commitFile(
			repoRoot,
			"pnpm-lock.yaml",
			"lockfileVersion: '9'\n",
			"Add pnpm lockfile",
		);
		const commands: string[] = [];

		// When gji new creates the worktree with automatic setup enabled.
		const result = await createNewCommand({
			runCommand: async (command) => {
				commands.push(command);
			},
		})({
			branch: "feature/automatic-install",
			cwd: repoRoot,
			noFetch: true,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then the supported adapter runs directly without an interactive prompt.
		expect(result).toBe(0);
		expect(commands).toEqual(["pnpm install --frozen-lockfile"]);
	});

	it("skips automatic dependency setup only when --no-install is passed", async () => {
		// Given a repository with a pnpm lockfile.
		const repoRoot = await createRepository();
		await commitFile(
			repoRoot,
			"pnpm-lock.yaml",
			"lockfileVersion: '9'\n",
			"Add pnpm lockfile",
		);
		let installCalled = false;

		// When gji new opts out for this worktree.
		const result = await createNewCommand({
			runCommand: async () => {
				installCalled = true;
			},
		})({
			branch: "feature/no-install",
			cwd: repoRoot,
			noFetch: true,
			noInstall: true,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then only dependency setup is skipped and worktree creation succeeds.
		expect(result).toBe(0);
		expect(installCalled).toBe(false);
	});
	describe("--dry-run", () => {
		it("emits what would be created without creating anything (text mode)", async () => {
			// Given a repository root and a new branch name.
			const repoRoot = await createRepository();
			const branchName = "feature/dry-run-text";
			const worktreePath = resolveWorktreePath(repoRoot, branchName);
			const stdout: string[] = [];

			// When gji new --dry-run runs with that branch.
			const result = await runCli(["new", "--dry-run", branchName], {
				cwd: repoRoot,
				stderr: () => undefined,
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it exits 0 and reports what would be created without creating the worktree.
			expect(result.exitCode).toBe(0);
			await expect(pathExists(worktreePath)).resolves.toBe(false);
			expect(stdout.join("")).toContain(worktreePath);
			expect(stdout.join("")).toContain(branchName);
		});

		it("emits { branch, path, dryRun: true } to stdout with --json --dry-run", async () => {
			// Given a repository root and a new branch name.
			const repoRoot = await createRepository();
			const branchName = "feature/dry-run-json";
			const worktreePath = resolveWorktreePath(repoRoot, branchName);
			const stdout: string[] = [];
			const stderr: string[] = [];

			// When gji new --json --dry-run runs with that branch.
			const result = await runCli(["new", "--json", "--dry-run", branchName], {
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it emits a JSON dry-run result without creating the worktree.
			expect(result.exitCode).toBe(0);
			expect(stderr).toEqual([]);
			await expect(pathExists(worktreePath)).resolves.toBe(false);
			const output = JSON.parse(stdout.join(""));
			expect(output).toEqual({
				branch: branchName,
				path: worktreePath,
				dryRun: true,
				repository: { name: basename(repoRoot), root: repoRoot },
			});
		});

		it("does not remove an existing worktree when --force --dry-run are combined", async () => {
			// Given an existing worktree for a branch.
			const repoRoot = await createRepository();
			const branchName = "feature/force-dry-run";
			const worktreePath = await addLinkedWorktree(repoRoot, branchName);
			const stdout: string[] = [];

			// When gji new --force --dry-run runs for that same branch.
			const result = await runCli(["new", "--force", "--dry-run", branchName], {
				cwd: repoRoot,
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it exits 0, reports what would be created, and leaves the existing worktree intact.
			expect(result.exitCode).toBe(0);
			await expect(pathExists(worktreePath)).resolves.toBe(true);
			await expect(currentBranch(worktreePath)).resolves.toBe(branchName);
			expect(stdout.join("")).toContain(worktreePath);
		});
	});

	describe("Hint: lines", () => {
		afterEach(() => {
			delete process.env.GJI_NO_TUI;
		});

		it("emits a Hint: line when the target path already exists in headless mode", async () => {
			// Given GJI_NO_TUI=1 and a branch whose worktree already exists.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			const branch = "feature/hint-conflict";
			await addLinkedWorktree(repoRoot, branch);
			const stderr: string[] = [];
			const runNewCommand = createNewCommand({
				promptForPathConflict: async () => {
					throw new Error("must not be called");
				},
			});

			// When gji new runs with that conflicting branch in headless mode.
			const result = await runNewCommand({
				branch,
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 and the Hint: line names the exact commands to resolve it.
			expect(result).toBe(1);
			const stderrText = stderr.join("");
			expect(stderrText).toContain("Hint:");
			expect(stderrText).toContain("gji done");
		});

		it("does NOT emit a Hint: line in --json mode when the target path already exists", async () => {
			// Given a branch whose worktree already exists.
			const repoRoot = await createRepository();
			const branch = "feature/hint-conflict-json";
			await addLinkedWorktree(repoRoot, branch);
			const stderr: string[] = [];
			const runNewCommand = createNewCommand({
				promptForPathConflict: async () => {
					throw new Error("must not be called");
				},
			});

			// When gji new --json runs with that conflicting branch.
			const result = await runNewCommand({
				branch,
				cwd: repoRoot,
				json: true,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 with a valid JSON error and no Hint: text mixed in.
			expect(result).toBe(1);
			const json = JSON.parse(stderr.join(""));
			expect(json).toHaveProperty("error");
			expect(stderr.join("")).not.toContain("Hint:");
		});
	});

	describe("worktreePath config", () => {
		it("creates the worktree under a custom base path from config", async () => {
			// Given a local config with a custom worktreePath and a new branch.
			const repoRoot = await createRepository();
			const customBase = await mkdtemp(join(tmpdir(), "gji-custom-base-"));
			const branchName = "feature/custom-base";

			await writeFile(
				join(repoRoot, ".gji.json"),
				JSON.stringify({ worktreePath: customBase }),
				"utf8",
			);

			// When gji new creates a worktree.
			const result = await runCli(["new", branchName], { cwd: repoRoot });

			// Then the worktree is created inside the custom base, not the default location.
			expect(result.exitCode).toBe(0);
			await expect(
				pathExists(join(customBase, "feature", "custom-base")),
			).resolves.toBe(true);
			await expect(
				pathExists(resolveWorktreePath(repoRoot, branchName)),
			).resolves.toBe(false);
		});

		it("creates the worktree under a tilde-prefixed custom base path from config", async () => {
			// Given a local config with a tilde-prefixed worktreePath under HOME.
			const home = await mkdtemp(join(tmpdir(), "gji-home-"));
			process.env.HOME = home;
			const repoRoot = await createRepository();
			const branchName = "feature/tilde-base";

			await writeFile(
				join(repoRoot, ".gji.json"),
				JSON.stringify({ worktreePath: "~/wt" }),
				"utf8",
			);

			// When gji new creates a worktree.
			const result = await runCli(["new", branchName], { cwd: repoRoot });

			// Then the worktree is created under ~/wt/feature/tilde-base.
			expect(result.exitCode).toBe(0);
			await expect(
				pathExists(join(home, "wt", "feature", "tilde-base")),
			).resolves.toBe(true);
		});

		it("falls back to default and warns when worktreePath is a relative path", async () => {
			// Given a local config with a relative worktreePath.
			const repoRoot = await createRepository();
			const stderr: string[] = [];
			const branchName = "feature/relative-base";
			const runNew = createNewCommand({});

			await writeFile(
				join(repoRoot, ".gji.json"),
				JSON.stringify({ worktreePath: "some/relative/path" }),
				"utf8",
			);

			// When gji new runs.
			const result = await runNew({
				branch: branchName,
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 0 using the default path and warns about the relative worktreePath.
			expect(result).toBe(0);
			expect(stderr.join("")).toContain("worktreePath");
			expect(stderr.join("")).toContain("some/relative/path");
			await expect(
				pathExists(resolveWorktreePath(repoRoot, branchName)),
			).resolves.toBe(true);
		});
	});

	describe("branch name validation", () => {
		it("rejects a branch name with a space", async () => {
			// Given a repository and a branch name containing a space.
			const repoRoot = await createRepository();
			const stderr: string[] = [];
			const runNew = createNewCommand({});

			// When gji new is called with that branch name.
			const result = await runNew({
				branch: "bad branch",
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 with an error about the invalid character.
			expect(result).toBe(1);
			expect(stderr.join("")).toContain("invalid character");
		});

		it("rejects a branch name starting with a dash", async () => {
			// Given a repository and a branch name starting with a dash.
			const repoRoot = await createRepository();
			const stderr: string[] = [];
			const runNew = createNewCommand({});

			// When gji new is called with that branch name.
			const result = await runNew({
				branch: "-bad",
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 with an error about starting with a dash.
			expect(result).toBe(1);
			expect(stderr.join("")).toContain("dash");
		});

		it("emits JSON error for an invalid branch name in --json mode", async () => {
			// Given a repository and --json mode.
			const repoRoot = await createRepository();
			const stderr: string[] = [];
			const runNew = createNewCommand({});

			// When gji new --json is called with an invalid branch name.
			const result = await runNew({
				branch: "bad..branch",
				cwd: repoRoot,
				json: true,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 and the stderr is valid JSON with an error field.
			expect(result).toBe(1);
			const json = JSON.parse(stderr.join(""));
			expect(json).toHaveProperty("error");
		});

		it("does not validate the name as a branch name for detached worktrees", async () => {
			// Detached worktree names are directory names, not branch names — git naming
			// rules don't apply, so names that would be invalid branches (e.g. containing
			// a dot prefix on a segment) are still accepted as worktree directory names.
			const repoRoot = await createRepository();
			const runNew = createNewCommand({});

			// When gji new --detach is called with a name that would fail branch validation.
			const result = await runNew({
				branch: "scratch",
				cwd: repoRoot,
				detached: true,
				stderr: () => undefined,
				stdout: () => undefined,
			});

			// Then it exits 0 (detached names skip branch-rule validation).
			expect(result).toBe(0);
		});
	});

	it("generates funny placeholder names as slug-safe mythic human-style branches", () => {
		// Given deterministic random choices.
		const placeholders = [
			generateBranchPlaceholder(() => 0),
			generateBranchPlaceholder(() => 0.49),
			generateBranchPlaceholder(() => 0.99),
		];

		// When each generated placeholder is checked.

		// Then the generated names stay slug-safe and use curated funny roots with a suffix.
		for (const placeholder of placeholders) {
			const parts = placeholder.split("-");
			const suffix = parts.at(-1);

			expect(placeholder).toMatch(/^[a-z0-9-]+$/);
			expect(parts[0]).toMatch(
				/^(socrates|prometheus|beethoven|ada|turing|hypatia|tesla|curie|diogenes|plato|hephaestus|athena|archimedes|euclid|heraclitus|galileo|newton|lovelace|nietzsche|kafka|sappho|aristotle|pythagoras|artemis|apollo|minerva|persephone|icarus|odysseus|murasaki|shakespeare|frida|davinci|kepler|copernicus|faraday|noether|hopper|boole|shannon|gauss|ramanujan|austen|borges|zeno)$/,
			);
			expect(parts.length).toBeGreaterThan(2);
			expect(suffix).toMatch(/^[a-z0-9]{3}$/);
		}
		expect(placeholders[2]).toBe("zeno-debugged-the-toaster-999");
	});

	it("generates the placeholder suffix from the injected random source", () => {
		// Given a deterministic random sequence for root, antic, and suffix characters.
		const randomValues = [0, 0.99, 0, 0.5, 0.99];
		const random = () => randomValues.shift() ?? 0;

		// When the placeholder is generated.
		const placeholder = generateBranchPlaceholder(random);

		// Then the suffix consumes values from the same injectable random source.
		expect(placeholder).toBe("socrates-debugged-the-toaster-as9");
	});
});

describe("gji new --open", () => {
	beforeEach(async () => {
		process.env.GJI_CONFIG_DIR = await mkdtemp(join(tmpdir(), "gji-config-"));
	});

	afterEach(() => {
		delete process.env.GJI_CONFIG_DIR;
	});

	it("opens the new worktree in the specified editor after creation", async () => {
		// Given a repository and Cursor as the chosen editor.
		const repoRoot = await createRepository();
		const branch = "feature/open-after-new";
		const spawned: { cli: string; args: string[] }[] = [];
		const runNewCommand = createNewCommand({
			spawnEditor: async (cli, args) => {
				spawned.push({ cli, args });
			},
		});

		// When gji new --open --editor cursor runs.
		const result = await runNewCommand({
			branch,
			cwd: repoRoot,
			editor: "cursor",
			open: true,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then it opens the new worktree in Cursor with --new-window.
		expect(result).toBe(0);
		expect(spawned).toHaveLength(1);
		expect(spawned[0].cli).toBe("cursor");
		expect(spawned[0].args).toContain("--new-window");
	});

	it("uses the saved config editor when --editor is not passed", async () => {
		// Given a repository with editor: "zed" in local config.
		const repoRoot = await createRepository();
		const branch = "feature/open-from-config";
		const spawned: { cli: string; args: string[] }[] = [];
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ editor: "zed" }),
			"utf8",
		);
		const runNewCommand = createNewCommand({
			spawnEditor: async (cli, args) => {
				spawned.push({ cli, args });
			},
		});

		// When gji new --open runs without --editor.
		const result = await runNewCommand({
			branch,
			cwd: repoRoot,
			open: true,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then it opens in Zed with no --new-window flag (Zed does not support it).
		expect(result).toBe(0);
		expect(spawned[0].cli).toBe("zed");
		expect(spawned[0].args).toEqual([expect.stringContaining(branch)]);
	});

	it("skips opening when --open is not passed", async () => {
		// Given a repository and no --open flag.
		const repoRoot = await createRepository();
		const branch = "feature/no-open";
		const runNewCommand = createNewCommand({
			spawnEditor: async () => {
				throw new Error("spawn must not be called without --open");
			},
		});

		// When gji new runs without --open.
		const result = await runNewCommand({
			branch,
			cwd: repoRoot,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then it exits successfully without spawning any editor.
		expect(result).toBe(0);
	});

	it("warns and continues when --open is used without an editor", async () => {
		// Given a repository with no editor configured or specified.
		const repoRoot = await createRepository();
		const branch = "feature/open-no-editor";
		const stderr: string[] = [];
		const runNewCommand = createNewCommand({
			spawnEditor: async () => undefined,
		});

		// When gji new --open runs without --editor and no saved config.
		const result = await runNewCommand({
			branch,
			cwd: repoRoot,
			open: true,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it exits 0, creates the worktree, and warns that --editor is required.
		expect(result).toBe(0);
		expect(stderr.join("")).toContain("--open requires --editor");
	});

	it("does not open in --dry-run mode", async () => {
		// Given a repository and --dry-run combined with --open.
		const repoRoot = await createRepository();
		const branch = "feature/open-dry-run";
		const runNewCommand = createNewCommand({
			spawnEditor: async () => {
				throw new Error("spawn must not be called in --dry-run mode");
			},
		});

		// When gji new --open --editor code --dry-run runs.
		const result = await runNewCommand({
			branch,
			cwd: repoRoot,
			dryRun: true,
			editor: "code",
			open: true,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then it exits 0 without spawning any editor.
		expect(result).toBe(0);
	});
});
