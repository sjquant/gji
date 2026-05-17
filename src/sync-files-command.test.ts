import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { GLOBAL_CONFIG_FILE_PATH } from "./config.js";
import { resolveWorktreePath } from "./repo.js";
import { createRepository, pathExists } from "./repo.test-helpers.js";

const originalHome = process.env.HOME;

afterEach(() => {
	if (originalHome === undefined) {
		delete process.env.HOME;
		return;
	}

	process.env.HOME = originalHome;
});

describe("gji sync-files", () => {
	it("adds sync files to the global config for the current repo", async () => {
		// Given a repository and an isolated home directory.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const stdout: string[] = [];
		process.env.HOME = home;

		// When gji adds secret files for that repo.
		const result = await runCli(["sync-files", "add", ".env.local", ".npmrc"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it persists them under the repo-specific global config entry.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toBe(".env.local\n.npmrc\n");
		await expect(readGlobalConfig(home)).resolves.toEqual({
			repos: {
				[repoRoot]: {
					syncFiles: [".env.local", ".npmrc"],
				},
			},
		});
	});

	it("lists sync files configured for the current repo", async () => {
		// Given a repository with repo-specific sync files in global config.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const stdout: string[] = [];
		process.env.HOME = home;
		await writeGlobalConfig(home, {
			repos: {
				[repoRoot]: {
					syncFiles: [".env.local", ".npmrc"],
				},
			},
		});

		// When gji lists sync files for that repo.
		const result = await runCli(["sync-files", "list"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints only the files for the current repo.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toBe(".env.local\n.npmrc\n");
	});

	it("uses an existing tilde-keyed repo config entry", async () => {
		// Given a repository whose global per-repo config is keyed relative to HOME.
		const repoRoot = await createRepository();
		const home = dirname(repoRoot);
		const stdout: string[] = [];
		process.env.HOME = home;
		await writeGlobalConfig(home, {
			repos: {
				"~/gji-test-repo": {
					syncFiles: [".env.local"],
				},
			},
		});

		// When gji adds another sync file for the current repo.
		const result = await runCli(["sync-files", "add", ".npmrc"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it preserves and updates the tilde-keyed entry instead of adding a duplicate absolute key.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toBe(".env.local\n.npmrc\n");
		await expect(readGlobalConfig(home)).resolves.toEqual({
			repos: {
				"~/gji-test-repo": {
					syncFiles: [".env.local", ".npmrc"],
				},
			},
		});
	});

	it("deduplicates added files while preserving existing order", async () => {
		// Given a repository with an existing sync file.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const stdout: string[] = [];
		process.env.HOME = home;
		await writeGlobalConfig(home, {
			repos: {
				[repoRoot]: {
					syncFiles: [".env.local"],
				},
			},
		});

		// When gji adds the existing file and a new file.
		const result = await runCli(["sync-files", "add", ".env.local", ".npmrc"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the existing file is not duplicated.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toBe(".env.local\n.npmrc\n");
		await expect(readGlobalConfig(home)).resolves.toMatchObject({
			repos: {
				[repoRoot]: {
					syncFiles: [".env.local", ".npmrc"],
				},
			},
		});
	});

	it("removes sync files from the current repo config without touching other repo settings", async () => {
		// Given two repo-specific global config entries.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const otherRepoRoot = await createRepository();
		const stdout: string[] = [];
		process.env.HOME = home;
		await writeGlobalConfig(home, {
			repos: {
				[repoRoot]: {
					branchPrefix: "feature/",
					syncFiles: [".env.local", ".npmrc"],
				},
				[otherRepoRoot]: {
					syncFiles: [".env"],
				},
			},
		});

		// When gji removes one file from the current repo.
		const result = await runCli(["sync-files", "remove", ".npmrc"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then only that repo's syncFiles list changes.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toBe(".env.local\n");
		await expect(readGlobalConfig(home)).resolves.toEqual({
			repos: {
				[repoRoot]: {
					branchPrefix: "feature/",
					syncFiles: [".env.local"],
				},
				[otherRepoRoot]: {
					syncFiles: [".env"],
				},
			},
		});
	});

	it("removes an empty repo entry when the last sync file is removed", async () => {
		// Given a repo-specific global config entry that only contains syncFiles.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const stdout: string[] = [];
		process.env.HOME = home;
		await writeGlobalConfig(home, {
			repos: {
				[repoRoot]: {
					syncFiles: [".env.local"],
				},
			},
		});

		// When gji removes the last sync file for that repo.
		const result = await runCli(["sync-files", "remove", ".env.local"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it deletes the now-empty per-repo config entry.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toBe("No sync files configured for this repo.\n");
		await expect(readGlobalConfig(home)).resolves.toEqual({
			repos: {},
		});
	});

	it("does not write config for a no-op remove with no repo entry", async () => {
		// Given a repository with no global config file.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const stdout: string[] = [];
		process.env.HOME = home;

		// When gji removes a sync file that is not configured.
		const result = await runCli(["sync-files", "remove", ".env.local"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it reports the empty list without creating config churn.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toBe("No sync files configured for this repo.\n");
		await expect(pathExists(GLOBAL_CONFIG_FILE_PATH(home))).resolves.toBe(
			false,
		);
	});

	it("syncs files into a new worktree after they are added globally for the repo", async () => {
		// Given a gitignored secret file in the main worktree.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const branchName = "feature/uses-secret";
		const worktreePath = resolveWorktreePath(repoRoot, branchName);
		process.env.HOME = home;
		await writeFile(join(repoRoot, ".gitignore"), ".env.local\n", "utf8");
		await writeFile(join(repoRoot, ".env.local"), "TOKEN=abc\n", "utf8");

		// When gji registers the file and creates a new worktree.
		const addResult = await runCli(["sync-files", "add", ".env.local"], {
			cwd: repoRoot,
		});
		const newResult = await runCli(["new", branchName], {
			cwd: repoRoot,
		});

		// Then the new worktree receives the gitignored file.
		expect(addResult.exitCode).toBe(0);
		expect(newResult.exitCode).toBe(0);
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(
			readFile(join(worktreePath, ".env.local"), "utf8"),
		).resolves.toBe("TOKEN=abc\n");
	});

	it("honors parent-position JSON mode for subcommands", async () => {
		// Given a repository and an isolated home directory.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const stdout: string[] = [];
		process.env.HOME = home;

		// When gji adds a sync file with --json on the parent command.
		const result = await runCli(["sync-files", "--json", "add", ".env.local"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the subcommand emits JSON.
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(stdout.join(""))).toEqual([".env.local"]);
	});

	it("rejects unsafe sync file paths before writing config", async () => {
		// Given a repository and an isolated home directory.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const stderr: string[] = [];
		process.env.HOME = home;

		// When gji tries to add a path outside the repo.
		const result = await runCli(["sync-files", "add", "../.env"], {
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
		});

		// Then it fails without creating a global config file.
		expect(result.exitCode).toBe(1);
		expect(stderr.join("")).toContain("pattern must not contain '..' segments");
		await expect(pathExists(GLOBAL_CONFIG_FILE_PATH(home))).resolves.toBe(
			false,
		);
	});

	it("emits JSON errors in JSON mode", async () => {
		// Given a repository and an isolated home directory.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const stderr: string[] = [];
		process.env.HOME = home;

		// When gji rejects an unsafe path in JSON mode.
		const result = await runCli(["sync-files", "add", "--json", "../.env"], {
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
		});

		// Then the error is script-readable JSON.
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(stderr.join(""))).toEqual({
			error: "syncFiles: pattern must not contain '..' segments, got: ../.env",
		});
	});
});

async function readGlobalConfig(
	home: string,
): Promise<Record<string, unknown>> {
	const rawConfig = await readFile(GLOBAL_CONFIG_FILE_PATH(home), "utf8");

	return JSON.parse(rawConfig) as Record<string, unknown>;
}

async function writeGlobalConfig(
	home: string,
	config: Record<string, unknown>,
): Promise<void> {
	const configPath = GLOBAL_CONFIG_FILE_PATH(home);

	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
