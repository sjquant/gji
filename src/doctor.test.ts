import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { GLOBAL_CONFIG_FILE_PATH } from "./config.js";
import { createRepository } from "./repo.test-helpers.js";

const originalConfigDir = process.env.GJI_CONFIG_DIR;
const originalHome = process.env.HOME;
const originalShell = process.env.SHELL;

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
});
