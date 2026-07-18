import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const notifierMocks = vi.hoisted(() => {
	const notify = vi.fn();
	const updateNotifier = vi.fn(() => ({ notify }));

	return { notify, updateNotifier };
});

vi.mock("update-notifier", () => ({
	default: notifierMocks.updateNotifier,
}));

import packageJson from "../package.json" with { type: "json" };
import { createProgram, runCli } from "./cli.js";
import { createRepository } from "./repo.test-helpers.js";
import { loadRegistry } from "./repo-registry.js";

afterEach(() => {
	delete process.env.GJI_NO_TUI;
	restoreStreamTty(process.stdout);
	restoreStreamTty(process.stderr);
	notifierMocks.notify.mockClear();
	notifierMocks.updateNotifier.mockClear();
});

describe("runCli", () => {
	it("prints help with the planned commands", async () => {
		// Given output collectors for the CLI help text.
		const stdout: string[] = [];
		const stderr: string[] = [];

		// When the top-level help command runs.
		const result = await runCli(["--help"], {
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		const output = stdout.join("");

		// Then the planned commands appear in help output.
		expect(result.exitCode).toBe(0);
		expect(stderr).toEqual([]);
		expect(output).toContain("Usage: gji");
		expect(output).toContain("new");
		expect(output).toContain("init");
		expect(output).toContain("doctor");
		expect(output).toContain("completion");
		expect(output).toContain("pr");
		expect(output).toContain("go");
		expect(output).toContain("status");
		expect(output).toContain("sync");
		expect(output).toContain("root");
		expect(output).toContain("ls");
		expect(output).toContain("clean");
		expect(output).toContain("remove");
		expect(output).toContain("rm");
	});

	it("describes gji pr as accepting generic PR references", async () => {
		// Given output collectors for the CLI help text.
		const stdout: string[] = [];
		const stderr: string[] = [];

		// When the top-level help command runs.
		const result = await runCli(["--help"], {
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		const output = stdout.join("");

		// Then the PR help text describes the supported ref formats.
		expect(result.exitCode).toBe(0);
		expect(stderr).toEqual([]);
		expect(output).toContain("pr [options] <ref>");
		expect(output).toContain("number");
		expect(output).toContain("#number");
		expect(output).toContain("URL");
	});

	it("registers pr open as a nested command", () => {
		// Given the Commander program definition.
		const program = createProgram();
		const prCommand = program.commands.find(
			(command) => command.name() === "pr",
		);

		// When the nested help information is rendered.
		const help = prCommand?.commands
			.find((command) => command.name() === "open")
			?.helpInformation();

		// Then the new target syntax is documented by Commander.
		expect(help).toContain("open [options] [target]");
		expect(help).toContain("--select");
	});

	it("dispatches the pr open selector flag through the CLI action", async () => {
		// Given headless mode and output collectors.
		process.env.GJI_NO_TUI = "1";
		const stderr: string[] = [];

		// When the nested selector command is invoked through runCli.
		const result = await runCli(["pr", "open", "--select"], {
			cwd: "/not-a-repository",
			stderr: (chunk) => stderr.push(chunk),
		});

		// Then the nested action forwards the selector-mode error and exit code.
		expect(result.exitCode).toBe(1);
		expect(stderr.join("")).toContain(
			"gji pr open --select: selector is unavailable",
		);
	});

	it("runs the current-worktree pr open flow through the CLI boundary", async () => {
		// Given a current repository and injected PR/browser boundaries.
		const repoRoot = await createRepository();
		const opened: string[] = [];
		const stdout: string[] = [];

		// When the executable command path runs without a target.
		const result = await runCli(["pr", "open"], {
			cwd: repoRoot,
			prOpenDependencies: {
				openBrowser: async (url) => {
					opened.push(url);
				},
				queryPullRequests: async (_root, sourceBranch) => [
					{
						number: 27,
						sourceBranch,
						url: "https://github.com/example/repo/pull/27",
					},
				],
			},
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then Commander dispatches to the current-worktree opener and reports success.
		expect(result.exitCode).toBe(0);
		expect(opened).toEqual(["https://github.com/example/repo/pull/27"]);
		expect(stdout.join("")).toContain("Opened PR #27");
	});

	it("passes the clean stale filter through command parsing", async () => {
		// Given a repository without stale linked worktrees and output collectors.
		const repoRoot = await createRepository();
		const stdout: string[] = [];
		const stderr: string[] = [];

		// When the clean command runs with the --stale filter through the CLI parser.
		const result = await runCli(["clean", "--stale", "--json", "--force"], {
			cwd: repoRoot,
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the command succeeds with an empty stale cleanup result.
		expect(result.exitCode).toBe(0);
		expect(stderr).toEqual([]);
		expect(JSON.parse(stdout.join(""))).toEqual({ removed: [] });
	});

	it("prints the package version", async () => {
		// Given output collectors for the CLI version text.
		const stdout: string[] = [];
		const stderr: string[] = [];

		// When the version flag runs.
		const result = await runCli(["--version"], {
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then only the package version is written to stdout.
		expect(result.exitCode).toBe(0);
		expect(stderr).toEqual([]);
		expect(stdout.join("")).toBe(`${packageJson.version}\n`);
	});

	it("runs the update notifier before interactive commands", async () => {
		// Given an interactive terminal and a notifier probe.
		setStreamTty(process.stdout, true);
		setStreamTty(process.stderr, true);
		const repoRoot = await createRepository();

		// When an interactive command runs.
		const result = await runCli(["status"], {
			cwd: repoRoot,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then the notifier receives the package metadata once.
		expect(result.exitCode).toBe(0);
		expect(notifierMocks.updateNotifier).toHaveBeenCalledTimes(1);
		expect(notifierMocks.notify).toHaveBeenCalledTimes(1);
		expect(notifierMocks.updateNotifier).toHaveBeenCalledWith({
			pkg: { name: packageJson.name, version: packageJson.version },
		});
	});

	it("skips the update notifier in JSON mode", async () => {
		// Given an interactive terminal and a notifier probe.
		setStreamTty(process.stdout, true);
		setStreamTty(process.stderr, true);
		const repoRoot = await createRepository();

		// When a JSON command runs.
		const result = await runCli(["status", "--json"], {
			cwd: repoRoot,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then the notifier is suppressed for machine-readable output.
		expect(result.exitCode).toBe(0);
		expect(notifierMocks.updateNotifier).not.toHaveBeenCalled();
		expect(notifierMocks.notify).not.toHaveBeenCalled();
	});

	it("skips the update notifier in headless mode", async () => {
		// Given an interactive terminal and headless mode enabled.
		setStreamTty(process.stdout, true);
		setStreamTty(process.stderr, true);
		process.env.GJI_NO_TUI = "1";
		const repoRoot = await createRepository();

		// When a command runs in headless mode.
		const result = await runCli(["status"], {
			cwd: repoRoot,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then the notifier stays silent.
		expect(result.exitCode).toBe(0);
		expect(notifierMocks.updateNotifier).not.toHaveBeenCalled();
		expect(notifierMocks.notify).not.toHaveBeenCalled();
	});

	it("registers the current repo in the configured registry directory", async () => {
		// Given a repository and an isolated config directory.
		const repoRoot = await createRepository();
		const configDir = await mkdtemp(join(tmpdir(), "gji-config-"));
		process.env.GJI_CONFIG_DIR = configDir;

		// When an interactive command runs from that repository.
		const result = await runCli(["status"], {
			cwd: repoRoot,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then the repo is recorded in the configured registry.
		expect(result.exitCode).toBe(0);
		await expect
			.poll(async () => loadRegistry())
			.toEqual([
				expect.objectContaining({
					name: "gji-test-repo",
					path: repoRoot,
				}),
			]);
	});
});

// Force TTY detection so CLI tests can cover interactive-only startup paths.
function setStreamTty(stream: NodeJS.WriteStream, value: boolean): void {
	Object.defineProperty(stream, "isTTY", {
		configurable: true,
		value,
		writable: true,
	});
}

function restoreStreamTty(stream: NodeJS.WriteStream): void {
	delete (stream as { isTTY?: boolean }).isTTY;
}
