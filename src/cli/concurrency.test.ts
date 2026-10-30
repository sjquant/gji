import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	cloneRepository,
	commitFile,
	createRepositoryWithOrigin,
	currentBranch,
	pushPullRequestRef,
	runGit,
	type SpawnedCli,
	spawnCli,
} from "../test-support/repository.js";

const PARALLEL_RUNS = 8;
const PROCESS_TEST_TIMEOUT_MS = 60_000;

function parallel<T>(run: (index: number) => Promise<T>): Promise<T[]> {
	return Promise.all(Array.from({ length: PARALLEL_RUNS }, (_, i) => run(i)));
}

function expectAllSucceeded(results: SpawnedCli[]): void {
	expect(results.map(({ exitCode, stderr }) => ({ exitCode, stderr }))).toEqual(
		results.map(() => ({ exitCode: 0, stderr: "" })),
	);
}

function readStateFile(name: string): Promise<unknown> {
	return readFile(
		join(process.env.GJI_CONFIG_DIR as string, name),
		"utf8",
	).then(JSON.parse);
}

async function branchConfig(repoRoot: string, branch: string): Promise<string> {
	return runGit(repoRoot, [
		"config",
		"--get-regexp",
		`^branch\\.${branch}\\.(remote|merge)$`,
	]).then((config) => config.replaceAll(branch, "<branch>"));
}

describe("parallel gji processes", () => {
	it(
		"creates every worktree with sequential upstream settings while origin has moved",
		async () => {
			// Given origin has a commit the repository has not fetched, so every
			// process has to update the same remote-tracking ref.
			const { originRoot, repoRoot } = await createRepositoryWithOrigin();
			const defaultBranch = await currentBranch(repoRoot);
			await spawnCli(repoRoot, ["new", "--json", "--no-install", "seq/base"]);
			const sequentialConfig = await branchConfig(repoRoot, "seq/base");
			const otherClone = await cloneRepository(originRoot);
			await commitFile(otherClone, "moved.txt", "moved\n", "move origin");
			await runGit(otherClone, ["push", "origin", "HEAD"]);
			const movedHead = await runGit(otherClone, ["rev-parse", "HEAD"]);

			// When gji new runs in parallel processes.
			const results = await parallel((i) =>
				spawnCli(repoRoot, ["new", "--json", "--no-install", `par/${i}`]),
			);

			// Then all succeed from the fresh base with the sequential upstream settings.
			expectAllSucceeded(results);
			for (const [i, result] of results.entries()) {
				const { path } = JSON.parse(result.stdout) as { path: string };
				expect(await runGit(path, ["rev-parse", "HEAD"])).toBe(movedHead);
				expect(await branchConfig(repoRoot, `par/${i}`)).toBe(sequentialConfig);
			}
			expect(sequentialConfig).toContain(`refs/heads/${defaultBranch}`);
		},
		PROCESS_TEST_TIMEOUT_MS,
	);

	it(
		"creates every PR worktree",
		async () => {
			// Given origin publishes a pull request ref for each process.
			const { repoRoot } = await createRepositoryWithOrigin();
			await parallel((i) => pushPullRequestRef(repoRoot, `${i + 1}`));

			// When gji pr runs in parallel processes.
			const results = await parallel((i) =>
				spawnCli(repoRoot, ["pr", "--json", "--no-install", `${i + 1}`]),
			);

			// Then all succeed and each branch tracks its pull request ref.
			expectAllSucceeded(results);
			for (let i = 1; i <= PARALLEL_RUNS; i += 1) {
				expect(await runGit(repoRoot, ["config", `branch.pr/${i}.merge`])).toBe(
					`refs/heads/pull/${i}/head`,
				);
			}
		},
		PROCESS_TEST_TIMEOUT_MS,
	);

	it(
		"keeps every entry in gji's state files",
		async () => {
			// Given a repository with an origin.
			const { repoRoot } = await createRepositoryWithOrigin();

			// When worktrees are created in parallel, then removed in parallel.
			const created = await parallel((i) =>
				spawnCli(repoRoot, ["new", "--no-install", `state/${i}`]),
			);
			expectAllSucceeded(created);
			const slots = (await readStateFile("slots.json")) as Record<
				string,
				number
			>;
			const history = (await readStateFile("history.json")) as unknown[];
			const repos = (await readStateFile("repos.json")) as unknown[];
			const removed = await parallel((i) =>
				spawnCli(repoRoot, ["done", "--force", "--json", `state/${i}`]),
			);
			expectAllSucceeded(removed);
			const undoLog = (await readStateFile("undo-log.json")) as unknown[];
			const remainingSlots = (await readStateFile("slots.json")) as Record<
				string,
				number
			>;

			// Then no process lost another's update: the repository root plus one
			// unique slot per worktree, then one undo record per removal.
			expect(Object.keys(slots)).toHaveLength(PARALLEL_RUNS + 1);
			expect(new Set(Object.values(slots)).size).toBe(PARALLEL_RUNS + 1);
			expect(history).toHaveLength(PARALLEL_RUNS);
			expect(repos).toHaveLength(1);
			expect(undoLog).toHaveLength(PARALLEL_RUNS);
			expect(Object.keys(remainingSlots)).toEqual([repoRoot]);
		},
		PROCESS_TEST_TIMEOUT_MS,
	);

	it(
		"gives a contested branch to one process and keeps it intact",
		async () => {
			// Given a repository with an origin.
			const { repoRoot } = await createRepositoryWithOrigin();

			// When parallel processes all claim the same branch.
			const results = await parallel(() =>
				spawnCli(repoRoot, ["new", "--json", "--no-install", "same/branch"]),
			);

			// Then one wins, and the losers' cleanup leaves its worktree and upstream.
			const worktrees = await runGit(repoRoot, ["worktree", "list"]);
			expect(worktrees.match(/same\/branch/g)?.length).toBe(2);
			const winners = results.filter((result) => result.exitCode === 0);
			expect(winners).toHaveLength(1);
			const { path } = JSON.parse(winners[0].stdout) as { path: string };
			expect(await currentBranch(path)).toBe("same/branch");
			expect(await branchConfig(repoRoot, "same/branch")).toContain(
				"refs/heads/",
			);
		},
		PROCESS_TEST_TIMEOUT_MS,
	);
});

describe("gji new under Git contention and failure", () => {
	it(
		"removes its branch and worktree when worktree creation fails",
		async () => {
			// Given a post-checkout hook that makes git worktree add fail after checkout.
			const { repoRoot } = await createRepositoryWithOrigin();
			await writeFailingPostCheckoutHook(repoRoot);

			// When gji new runs.
			const result = await spawnCli(repoRoot, [
				"new",
				"--json",
				"--no-install",
				"failed/branch",
			]);

			// Then the error is reported, and no branch, worktree, or upstream remains.
			expect(result.exitCode).toBe(1);
			expect(JSON.parse(result.stderr).error).toContain(
				"failed to create worktree",
			);
			expect(
				await runGit(repoRoot, ["branch", "--list", "failed/branch"]),
			).toBe("");
			expect(await runGit(repoRoot, ["worktree", "list"])).not.toContain(
				"failed/branch",
			);
			expect(await runGit(repoRoot, ["config", "--list"])).not.toContain(
				"branch.failed/branch",
			);
		},
		PROCESS_TEST_TIMEOUT_MS,
	);

	it(
		"keeps an existing branch when adding its worktree fails",
		async () => {
			// Given a post-checkout hook that fails, and a branch that already exists.
			const { repoRoot } = await createRepositoryWithOrigin();
			await runGit(repoRoot, ["branch", "existing/branch"]);
			await writeFailingPostCheckoutHook(repoRoot);

			// When gji new checks out that branch and git worktree add fails.
			const result = await spawnCli(repoRoot, [
				"new",
				"--json",
				"--no-install",
				"existing/branch",
			]);

			// Then the worktree it added is gone, and the existing branch is kept.
			expect(result.exitCode).toBe(1);
			expect(await runGit(repoRoot, ["worktree", "list"])).not.toContain(
				"existing/branch",
			);
			expect(
				await runGit(repoRoot, ["branch", "--list", "existing/branch"]),
			).toContain("existing/branch");
		},
		PROCESS_TEST_TIMEOUT_MS,
	);

	it(
		"removes its branch when taken changes cannot be applied",
		async () => {
			// Given dirty changes, and a hook that dirties the same file in new worktrees.
			const { repoRoot } = await createRepositoryWithOrigin();
			await writeFile(join(repoRoot, "README.md"), "taken\n", "utf8");
			const hookPath = join(repoRoot, ".git", "hooks", "post-checkout");
			await writeFile(
				hookPath,
				'#!/bin/sh\necho conflict > "$PWD/README.md"\n',
				{ mode: 0o755 },
			);

			// When gji new --take cannot apply them to the new worktree.
			const result = await spawnCli(repoRoot, [
				"new",
				"--json",
				"--no-install",
				"--take",
				"taken/branch",
			]);

			// Then the original changes stay put, and no branch or worktree remains.
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("could not apply taken changes");
			expect(await readFile(join(repoRoot, "README.md"), "utf8")).toBe(
				"taken\n",
			);
			expect(await runGit(repoRoot, ["branch", "--list", "taken/branch"])).toBe(
				"",
			);
			expect(await runGit(repoRoot, ["worktree", "list"])).not.toContain(
				"taken/branch",
			);
		},
		PROCESS_TEST_TIMEOUT_MS,
	);

	it(
		"removes its branch and worktree when the worktree path is a symlink",
		async () => {
			// Given a worktreePath configured through a symlink, and a post-checkout hook that fails.
			const { repoRoot } = await createRepositoryWithOrigin();
			const realBase = `${repoRoot}-real`;
			const linkedBase = `${repoRoot}-link`;
			await mkdir(realBase);
			await symlink(realBase, linkedBase);
			await writeFile(
				join(repoRoot, ".gji.json"),
				JSON.stringify({ worktreePath: linkedBase }),
				"utf8",
			);
			await writeFailingPostCheckoutHook(repoRoot);

			// When gji new runs.
			const result = await spawnCli(repoRoot, [
				"new",
				"--json",
				"--no-install",
				"linked/branch",
			]);

			// Then neither the branch nor the worktree remains.
			expect(result.exitCode).toBe(1);
			expect(
				await runGit(repoRoot, ["branch", "--list", "linked/branch"]),
			).toBe("");
			expect(await runGit(repoRoot, ["worktree", "list"])).not.toContain(
				"linked/branch",
			);
		},
		PROCESS_TEST_TIMEOUT_MS,
	);

	it(
		"keeps the caller's locale for Git hooks",
		async () => {
			// Given a post-checkout hook that records its locale, and a caller's locale.
			const { repoRoot } = await createRepositoryWithOrigin();
			const localeFile = `${repoRoot}-hook-locale`;
			await writeFile(
				join(repoRoot, ".git", "hooks", "post-checkout"),
				`#!/bin/sh\necho "$LC_ALL" > "${localeFile}"\n`,
				{ mode: 0o755 },
			);
			const callerLocale = process.env.LC_ALL;
			process.env.LC_ALL = "en_US.UTF-8";

			try {
				// When gji new runs that hook.
				const result = await spawnCli(repoRoot, [
					"new",
					"--json",
					"--no-install",
					"locale/branch",
				]);

				// Then the hook sees the caller's locale.
				expect(result.exitCode).toBe(0);
				expect((await readFile(localeFile, "utf8")).trim()).toBe("en_US.UTF-8");
			} finally {
				if (callerLocale === undefined) delete process.env.LC_ALL;
				else process.env.LC_ALL = callerLocale;
			}
		},
		PROCESS_TEST_TIMEOUT_MS,
	);

	it(
		"creates the worktree over an empty leftover directory with --force",
		async () => {
			// Given an empty directory at the target path that is not a worktree.
			const { repoRoot } = await createRepositoryWithOrigin();
			const dryRun = await spawnCli(repoRoot, [
				"new",
				"--json",
				"--dry-run",
				"--no-install",
				"leftover/branch",
			]);
			const { path } = JSON.parse(dryRun.stdout) as { path: string };
			await mkdir(path, { recursive: true });

			// When gji new --force targets it.
			const result = await spawnCli(repoRoot, [
				"new",
				"--json",
				"--force",
				"--no-install",
				"leftover/branch",
			]);

			// Then the worktree takes over that path.
			expect(result.exitCode).toBe(0);
			expect(await currentBranch(path)).toBe("leftover/branch");
		},
		PROCESS_TEST_TIMEOUT_MS,
	);

	it(
		"removes its branch when --branch-only cannot switch to it",
		async () => {
			// Given a held index lock, which blocks git switch but not git branch.
			const { repoRoot } = await createRepositoryWithOrigin();
			const before = await currentBranch(repoRoot);
			await writeFile(join(repoRoot, ".git", "index.lock"), "");

			// When gji new --branch-only runs.
			const result = await spawnCli(repoRoot, [
				"new",
				"--json",
				"--branch-only",
				"switch/branch",
			]);
			await rm(join(repoRoot, ".git", "index.lock"));

			// Then it fails, stays on the current branch, and removes the new one.
			expect(result.exitCode).toBe(1);
			expect(await currentBranch(repoRoot)).toBe(before);
			expect(
				await runGit(repoRoot, ["branch", "--list", "switch/branch"]),
			).toBe("");
		},
		PROCESS_TEST_TIMEOUT_MS,
	);
});

describe("gji pr under failure", () => {
	it(
		"reports a JSON error and removes its branch and worktree",
		async () => {
			// Given a published PR ref, and a post-checkout hook that fails.
			const { repoRoot } = await createRepositoryWithOrigin();
			await pushPullRequestRef(repoRoot, "7");
			await writeFailingPostCheckoutHook(repoRoot);

			// When gji pr --json runs.
			const result = await spawnCli(repoRoot, [
				"pr",
				"--json",
				"--no-install",
				"7",
			]);

			// Then stderr holds the JSON error, and no branch or worktree remains.
			expect(result.exitCode).toBe(1);
			expect(JSON.parse(result.stderr).error).toContain(
				"failed to create worktree",
			);
			expect(await runGit(repoRoot, ["branch", "--list", "pr/7"])).toBe("");
			expect(await runGit(repoRoot, ["worktree", "list"])).not.toContain(
				"pr/7",
			);
		},
		PROCESS_TEST_TIMEOUT_MS,
	);
});

function writeFailingPostCheckoutHook(repoRoot: string): Promise<void> {
	return writeFile(
		join(repoRoot, ".git", "hooks", "post-checkout"),
		"#!/bin/sh\nexit 1\n",
		{ mode: 0o755 },
	);
}
