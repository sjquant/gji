import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { GLOBAL_CONFIG_FILE_PATH } from "./config.js";
import { runDoctorCommand } from "./doctor.js";
import { createRepository } from "./repo.test-helpers.js";
import { loadRegistry, REGISTRY_FILE_PATH } from "./repo-registry.js";

const originalConfigDir = process.env.GJI_CONFIG_DIR;
const originalHome = process.env.HOME;
const originalShell = process.env.SHELL;
const originalHeadless = process.env.GJI_NO_TUI;

afterEach(() => {
	if (originalConfigDir === undefined) {
		delete process.env.GJI_CONFIG_DIR;
	} else {
		process.env.GJI_CONFIG_DIR = originalConfigDir;
	}

	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}

	if (originalShell === undefined) {
		delete process.env.SHELL;
	} else {
		process.env.SHELL = originalShell;
	}

	if (originalHeadless === undefined) {
		delete process.env.GJI_NO_TUI;
	} else {
		process.env.GJI_NO_TUI = originalHeadless;
	}
});

describe("gji doctor", () => {
	it("reports ordered JSON checks for a configured repository", async () => {
		// Given an isolated repository, home directory, config directory, and zsh integration.
		const repoRoot = await createRepository();
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const configDir = await mkdtemp(join(tmpdir(), "gji-config-"));
		process.env.GJI_CONFIG_DIR = configDir;
		process.env.HOME = home;
		process.env.SHELL = "/bin/zsh";
		await writeFile(join(home, ".zshrc"), 'eval "$(gji init zsh)"\n', "utf8");
		await mkdir(dirname(GLOBAL_CONFIG_FILE_PATH(home)), { recursive: true });
		await writeFile(GLOBAL_CONFIG_FILE_PATH(home), "{}\n", "utf8");
		const stdout: string[] = [];

		// When the JSON diagnostic command runs through the CLI.
		const result = await runCli(["doctor", "--json"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it keeps the documented checks in order without reporting a problem.
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(stdout.join(""))).toEqual({
			checks: [
				expect.objectContaining({ id: "git-version", status: "ok" }),
				expect.objectContaining({ id: "shell-integration", status: "ok" }),
				expect.objectContaining({ id: "completion", status: "skip" }),
				expect.objectContaining({ id: "global-config", status: "ok" }),
				expect.objectContaining({ id: "local-config", status: "ok" }),
				expect.objectContaining({ id: "worktree-base", status: "ok" }),
				expect.objectContaining({ id: "repo-registry", status: "ok" }),
				expect.objectContaining({ id: "editor", status: "skip" }),
			],
			problems: 0,
		});
	});

	it("uses checkmarks, skips, and a zero-problem summary for human output", async () => {
		// Given a repository with shell integration and an isolated global config.
		const repoRoot = await createRepository();
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		process.env.GJI_CONFIG_DIR = await mkdtemp(join(tmpdir(), "gji-config-"));
		process.env.HOME = home;
		process.env.SHELL = "/bin/zsh";
		await writeFile(join(home, ".zshrc"), 'eval "$(gji init zsh)"\n', "utf8");
		const stdout: string[] = [];

		// When the human-readable diagnostic command runs through the CLI.
		const result = await runCli(["doctor"], {
			cwd: repoRoot,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints the checklist and optional completion skip without failing.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toContain("gji doctor");
		expect(stdout.join("")).toContain("✓ git");
		expect(stdout.join("")).toContain(
			"- zsh completion not installed (optional)",
		);
		expect(stdout.join("")).toContain("0 problems found.");
	});

	it("reports when no automatic fixes are available", async () => {
		// Given an isolated environment with no stale registry entries.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		process.env.GJI_CONFIG_DIR = await mkdtemp(join(tmpdir(), "gji-config-"));
		process.env.HOME = home;
		delete process.env.SHELL;
		const stdout: string[] = [];

		// When doctor runs with the fix mode enabled.
		const result = await runCli(["doctor", "--fix"], {
			cwd: await mkdtemp(join(tmpdir(), "gji-outside-repo-")),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it succeeds and explains that there is nothing safe to change.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toContain("No automatic fixes available.");
	});

	it("keeps doctor read-only by not registering the current repository", async () => {
		// Given a repository and an isolated registry directory.
		const repoRoot = await createRepository();
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		process.env.GJI_CONFIG_DIR = await mkdtemp(join(tmpdir(), "gji-config-"));
		process.env.HOME = home;
		delete process.env.SHELL;

		// When doctor runs from that repository.
		const result = await runCli(["doctor", "--json"], {
			cwd: repoRoot,
			stdout: () => undefined,
		});

		// Then the diagnostic command does not add a registry entry as a side effect.
		expect(result.exitCode).toBe(0);
		expect(await loadRegistry(home)).toEqual([]);
	});

	it("explains how to create a missing shell rc file", async () => {
		// Given an isolated home without a zsh rc file.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		process.env.GJI_CONFIG_DIR = await mkdtemp(join(tmpdir(), "gji-config-"));
		process.env.HOME = home;
		process.env.SHELL = "/bin/zsh";
		const stdout: string[] = [];

		// When gji doctor checks setup outside a Git repository.
		const result = await runCli(["doctor", "--json"], {
			cwd: await mkdtemp(join(tmpdir(), "gji-outside-repo-")),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the failed shell check includes a file-creation hint.
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(stdout.join(""))).toEqual(
			expect.objectContaining({
				checks: expect.arrayContaining([
					expect.objectContaining({
						hint: expect.stringContaining(`create ${join(home, ".zshrc")}`),
						id: "shell-integration",
						status: "fail",
					}),
				]),
				problems: 1,
			}),
		);
	});

	it("does not treat a commented shell integration command as active", async () => {
		// Given an isolated home whose zsh rc file only contains a disabled integration command.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		process.env.GJI_CONFIG_DIR = await mkdtemp(join(tmpdir(), "gji-config-"));
		process.env.HOME = home;
		process.env.SHELL = "/bin/zsh";
		await writeFile(join(home, ".zshrc"), '# eval "$(gji init zsh)"\n', "utf8");
		const stdout: string[] = [];

		// When gji doctor checks the shell setup.
		const result = await runCli(["doctor", "--json"], {
			cwd: await mkdtemp(join(tmpdir(), "gji-outside-repo-")),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it reports the disabled integration as missing and returns failure.
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(stdout.join(""))).toEqual(
			expect.objectContaining({
				checks: expect.arrayContaining([
					expect.objectContaining({
						id: "shell-integration",
						status: "fail",
					}),
				]),
				problems: 1,
			}),
		);
	});

	it("fails with a malformed global config in JSON mode", async () => {
		// Given an isolated config directory containing malformed global JSON.
		const configDir = await mkdtemp(join(tmpdir(), "gji-config-"));
		process.env.GJI_CONFIG_DIR = configDir;
		delete process.env.SHELL;
		await writeFile(join(configDir, "config.json"), "{ malformed", "utf8");
		const stdout: string[] = [];

		// When gji doctor checks a non-repository directory.
		const result = await runCli(["doctor", "--json"], {
			cwd: await mkdtemp(join(tmpdir(), "gji-outside-repo-")),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the global-config check fails and sets a non-zero exit code.
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(stdout.join(""))).toEqual(
			expect.objectContaining({
				checks: expect.arrayContaining([
					expect.objectContaining({
						id: "global-config",
						status: "fail",
					}),
				]),
				problems: 1,
			}),
		);
	});

	it("skips repository checks outside Git without treating them as problems", async () => {
		// Given an isolated non-repository directory with no detectable shell.
		const configDir = await mkdtemp(join(tmpdir(), "gji-config-"));
		process.env.GJI_CONFIG_DIR = configDir;
		delete process.env.SHELL;
		const stdout: string[] = [];

		// When gji doctor runs outside a Git repository.
		const result = await runCli(["doctor", "--json"], {
			cwd: await mkdtemp(join(tmpdir(), "gji-outside-repo-")),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then local config and worktree checks are skipped while the command succeeds.
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(stdout.join(""))).toEqual(
			expect.objectContaining({
				checks: expect.arrayContaining([
					expect.objectContaining({ id: "local-config", status: "skip" }),
					expect.objectContaining({ id: "worktree-base", status: "skip" }),
				]),
				problems: 0,
			}),
		);
	});

	it("removes stale registry entries and preserves reachable entries with --yes", async () => {
		// Given a registry containing one reachable path and one missing path.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const configDir = await mkdtemp(join(tmpdir(), "gji-config-"));
		const reachablePath = await mkdtemp(join(tmpdir(), "gji-reachable-"));
		const missingPath = join(tmpdir(), `gji-missing-${Date.now()}`);
		process.env.GJI_CONFIG_DIR = configDir;
		process.env.HOME = home;
		delete process.env.SHELL;
		const entries = [
			{ lastUsed: 2, name: "reachable", path: reachablePath },
			{ lastUsed: 1, name: "missing", path: missingPath },
		];
		await writeFile(
			REGISTRY_FILE_PATH(home),
			`${JSON.stringify(entries)}\n`,
			"utf8",
		);
		const stdout: string[] = [];

		// When doctor applies the requested automatic fix without prompting.
		const result = await runCli(["doctor", "--json", "--fix", "--yes"], {
			cwd: await mkdtemp(join(tmpdir(), "gji-outside-repo-")),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it re-checks successfully and writes only the reachable entry.
		const output = JSON.parse(stdout.join(""));
		expect(result.exitCode).toBe(0);
		expect(output.problems).toBe(0);
		expect(output.fixes).toEqual([
			expect.objectContaining({ id: "repo-registry", status: "applied" }),
		]);
		expect(output.checks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "repo-registry", status: "ok" }),
			]),
		);
		expect(
			JSON.parse(await readFile(REGISTRY_FILE_PATH(home), "utf8")),
		).toEqual([entries[0]]);
	});

	it("does not mutate a stale registry in headless mode without --yes", async () => {
		// Given a headless process and a registry containing a missing path.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const configDir = await mkdtemp(join(tmpdir(), "gji-config-"));
		const missingPath = join(tmpdir(), `gji-missing-${Date.now()}`);
		process.env.GJI_CONFIG_DIR = configDir;
		process.env.HOME = home;
		process.env.GJI_NO_TUI = "1";
		delete process.env.SHELL;
		const entry = { lastUsed: 1, name: "missing", path: missingPath };
		await writeFile(
			REGISTRY_FILE_PATH(home),
			`${JSON.stringify([entry])}\n`,
			"utf8",
		);
		const stdout: string[] = [];

		// When doctor is asked to fix without the non-interactive approval flag.
		const result = await runCli(["doctor", "--json", "--fix"], {
			cwd: await mkdtemp(join(tmpdir(), "gji-outside-repo-")),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it reports a pending fix, fails, and leaves the registry untouched.
		const output = JSON.parse(stdout.join(""));
		expect(result.exitCode).toBe(1);
		expect(output.problems).toBe(1);
		expect(output.fixes).toEqual([
			expect.objectContaining({ status: "pending" }),
		]);
		expect(
			JSON.parse(await readFile(REGISTRY_FILE_PATH(home), "utf8")),
		).toEqual([entry]);
	});

	it("asks for confirmation before applying fixes in an interactive terminal", async () => {
		// Given an interactive doctor invocation and a registry with one stale path.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const configDir = await mkdtemp(join(tmpdir(), "gji-config-"));
		const missingPath = join(tmpdir(), `gji-missing-${Date.now()}`);
		process.env.GJI_CONFIG_DIR = configDir;
		process.env.HOME = home;
		delete process.env.SHELL;
		const entry = { lastUsed: 1, name: "missing", path: missingPath };
		await writeFile(
			REGISTRY_FILE_PATH(home),
			`${JSON.stringify([entry])}\n`,
			"utf8",
		);
		const stdout: string[] = [];
		let promptedFixes = 0;

		// When the interactive command receives an affirmative injected confirmation.
		const result = await runDoctorCommand({
			confirmFixes: async (fixes) => {
				promptedFixes = fixes.length;
				return true;
			},
			cwd: await mkdtemp(join(tmpdir(), "gji-outside-repo-")),
			fix: true,
			home,
			interactive: true,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it confirms one fix, applies it, and reports no remaining problems.
		expect(result).toBe(0);
		expect(promptedFixes).toBe(1);
		expect(
			JSON.parse(await readFile(REGISTRY_FILE_PATH(home), "utf8")),
		).toEqual([]);
		expect(stdout.join("\n")).toContain("✓ removed 1 stale repository entry");
	});

	it("rechecks a registry path after confirmation before removing it", async () => {
		// Given a stale registry path that will be restored during confirmation.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const configDir = await mkdtemp(join(tmpdir(), "gji-config-"));
		const restoredPath = join(tmpdir(), `gji-restored-${Date.now()}`);
		process.env.GJI_CONFIG_DIR = configDir;
		process.env.HOME = home;
		delete process.env.SHELL;
		const entry = { lastUsed: 1, name: "restored", path: restoredPath };
		await writeFile(
			REGISTRY_FILE_PATH(home),
			`${JSON.stringify([entry])}\n`,
			"utf8",
		);

		// When confirmation restores the path before the safe removal transaction runs.
		const result = await runDoctorCommand({
			confirmFixes: async () => {
				await mkdir(restoredPath);
				return true;
			},
			cwd: await mkdtemp(join(tmpdir(), "gji-outside-repo-")),
			fix: true,
			home,
			interactive: true,
			stdout: () => undefined,
		});

		// Then the restored reachable entry remains registered and the command succeeds.
		expect(result).toBe(0);
		expect(await loadRegistry(home)).toEqual([entry]);
	});

	it("does not offer inaccessible registry paths as automatic fixes", async () => {
		// Given a registry entry whose path cannot be inspected rather than missing.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const configDir = await mkdtemp(join(tmpdir(), "gji-config-"));
		const inaccessibleParent = await mkdtemp(
			join(tmpdir(), "gji-inaccessible-"),
		);
		const inaccessiblePath = join(inaccessibleParent, "loop");
		await symlink(inaccessiblePath, inaccessiblePath);
		process.env.GJI_CONFIG_DIR = configDir;
		process.env.HOME = home;
		delete process.env.SHELL;
		await writeFile(
			REGISTRY_FILE_PATH(home),
			`${JSON.stringify([
				{ lastUsed: 1, name: "inaccessible", path: inaccessiblePath },
			])}\n`,
			"utf8",
		);
		const stdout: string[] = [];

		// When doctor checks the registry and encounters the symlink loop.
		const result = await runDoctorCommand({
			cwd: await mkdtemp(join(tmpdir(), "gji-outside-repo-")),
			fix: true,
			home,
			interactive: false,
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then no automatic fix is offered and the registry entry is preserved.
		expect(result).toBe(1);
		expect(stdout.join("")).toContain("No automatic fixes available.");
		expect(await loadRegistry(home)).toHaveLength(1);
	});

	it("writes invalid --yes JSON usage errors to stderr", async () => {
		// Given separate JSON stdout and stderr collectors.
		const stdout: string[] = [];
		const stderr: string[] = [];

		// When --yes is passed without --fix.
		const result = await runCli(["doctor", "--json", "--yes"], {
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then stdout stays clean and stderr contains the machine-readable error.
		expect(result.exitCode).toBe(1);
		expect(stdout).toEqual([]);
		expect(JSON.parse(stderr.join(""))).toEqual({
			error: "--yes requires --fix",
		});
	});
});
