import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const promptMocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	intro: vi.fn(),
	isCancel: vi.fn(() => false),
	log: { info: vi.fn(), success: vi.fn() },
	outro: vi.fn(),
	select: vi.fn(),
	text: vi.fn(),
}));

vi.mock("@clack/prompts", () => promptMocks);

import { runCli } from "./cli.js";
import { GLOBAL_CONFIG_FILE_PATH } from "./config.js";
import { runInitCommand } from "./init.js";

const originalHome = process.env.HOME;
const originalShell = process.env.SHELL;
const originalConfigDir = process.env.GJI_CONFIG_DIR;
const originalHeadless = process.env.GJI_NO_TUI;

afterEach(() => {
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

	promptMocks.confirm.mockReset();
	promptMocks.intro.mockReset();
	promptMocks.isCancel.mockReset();
	promptMocks.isCancel.mockReturnValue(false);
	promptMocks.log.info.mockReset();
	promptMocks.log.success.mockReset();
	promptMocks.outro.mockReset();
	promptMocks.select.mockReset();
	promptMocks.text.mockReset();
});

describe("gji init", () => {
	it("prints zsh integration code explicitly", async () => {
		// Given a command output collector.
		const stdout: string[] = [];

		// When gji init runs for zsh explicitly.
		const result = await runCli(["init", "zsh"], {
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints the shell integration wrapper without bundled completions.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toContain("# >>> gji init >>>");
		expect(stdout.join("")).toContain("gji() {");
		expect(stdout.join("")).not.toContain("__gji_worktree_branches() {");
		expect(stdout.join("")).not.toContain("compdef _gji_completion gji");
		expect(stdout.join("")).toContain("# <<< gji init <<<");
	});

	it("prints fish integration code explicitly", async () => {
		// Given a command output collector.
		const stdout: string[] = [];

		// When gji init runs for fish explicitly.
		const result = await runCli(["init", "fish"], {
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints the shell integration wrapper.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toBe(expectedFishIntegration());
	});

	it("requires an interactive terminal when no shell is provided", async () => {
		// Given a zsh SHELL environment and non-interactive output collectors.
		const stdout: string[] = [];
		const stderr: string[] = [];
		process.env.SHELL = "/bin/zsh";

		// When gji init runs without an explicit shell argument.
		const result = await runCli(["init"], {
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it explains how to use the legacy non-interactive install path.
		expect(result.exitCode).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr.join("")).toBe(
			"run `gji init <shell> --write` in non-interactive mode\n",
		);
	});

	it("emits a JSON error for no-argument init in JSON mode", async () => {
		// Given a command output collector in JSON mode.
		const stdout: string[] = [];
		const stderr: string[] = [];

		// When gji init requests machine-readable output without a shell argument.
		const result = await runCli(["init", "--json"], {
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it returns the documented machine-readable error without stdout noise.
		expect(result.exitCode).toBe(1);
		expect(stdout).toEqual([]);
		expect(JSON.parse(stderr.join(""))).toEqual({
			error: "run `gji init <shell> --write` in non-interactive mode",
		});
	});

	it("writes zsh integration to the shell rc file with --write", async () => {
		// Given an isolated home directory and working directory.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		process.env.HOME = home;
		const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));

		// When gji init writes the zsh integration to disk.
		const result = await runCli(["init", "zsh", "--write"], { cwd });

		// Then the zsh rc file contains the integration wrapper without completions.
		expect(result.exitCode).toBe(0);
		await expect(readFile(join(home, ".zshrc"), "utf8")).resolves.not.toContain(
			"compdef _gji_completion gji",
		);
	});

	it("writes fish integration to the shell config file with --write", async () => {
		// Given an isolated home directory and working directory.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		process.env.HOME = home;
		const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));

		// When gji init writes the fish integration to disk.
		const result = await runCli(["init", "fish", "--write"], { cwd });

		// Then the fish config contains the integration wrapper.
		expect(result.exitCode).toBe(0);
		await expect(
			readFile(join(home, ".config", "fish", "config.fish"), "utf8"),
		).resolves.toBe(expectedFishIntegration());
	});

	it("does not duplicate the zsh integration block when --write runs twice", async () => {
		// Given an isolated home directory and working directory.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		process.env.HOME = home;
		const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));

		// When gji init writes the zsh integration twice.
		expect((await runCli(["init", "zsh", "--write"], { cwd })).exitCode).toBe(
			0,
		);
		expect((await runCli(["init", "zsh", "--write"], { cwd })).exitCode).toBe(
			0,
		);

		// Then the shell config contains only one integration block.
		const content = await readFile(join(home, ".zshrc"), "utf8");

		expect(content.match(/# >>> gji init >>>/g)).toHaveLength(1);
		expect(content.match(/# <<< gji init <<</g)).toHaveLength(1);
	});

	it("prints bash integration without bundling bash completions", async () => {
		// Given a command output collector.
		const stdout: string[] = [];

		// When gji init runs for bash explicitly.
		const result = await runCli(["init", "bash"], {
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the script contains only the bash wrapper code.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).not.toContain("_gji_completion() {");
		expect(stdout.join("")).not.toContain("complete -F _gji_completion gji");
	});

	it("prints fish integration without bundling fish completions", async () => {
		// Given a command output collector.
		const stdout: string[] = [];

		// When gji init runs for fish explicitly.
		const result = await runCli(["init", "fish"], {
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then the script contains only the fish wrapper code.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).not.toContain("function __gji_worktree_branches");
		expect(stdout.join("")).not.toContain(
			"complete -c gji -n '__fish_use_subcommand' -a 'new'",
		);
	});
});

describe("gji init onboarding wizard", () => {
	it("installs zsh integration, completion, and the selected editor idempotently", async () => {
		// Given isolated home and config directories with an approved zsh onboarding plan.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const configDir = await mkdtemp(join(tmpdir(), "gji-config-"));
		const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));
		process.env.GJI_CONFIG_DIR = configDir;
		const plan = {
			editor: "code",
			installCompletion: true,
			shellIntegration: "install" as const,
			shell: "zsh" as const,
		};

		// When the no-argument onboarding flow runs twice with the same plan.
		expect(
			await runInitCommand({
				cwd,
				home,
				interactive: true,
				promptForOnboarding: async () => plan,
				stdout: () => undefined,
			}),
		).toBe(0);
		expect(
			await runInitCommand({
				cwd,
				home,
				interactive: true,
				promptForOnboarding: async () => plan,
				stdout: () => undefined,
			}),
		).toBe(0);

		// Then the rc file has one shell block and completion path, and editor config is saved.
		const rcFile = await readFile(join(home, ".zshrc"), "utf8");
		expect(rcFile.match(/# >>> gji shell integration >>>/g)).toHaveLength(1);
		expect(
			rcFile.match(/fpath=\(~\/\.zsh\/completions \$fpath\)/g),
		).toHaveLength(1);
		expect(rcFile).toContain('eval "$(gji init zsh)"');
		await expect(
			readFile(join(home, ".zsh", "completions", "_gji"), "utf8"),
		).resolves.toContain("#compdef gji");
		expect(
			JSON.parse(await readFile(GLOBAL_CONFIG_FILE_PATH(home), "utf8")),
		).toEqual(
			expect.objectContaining({ editor: "code", shellIntegration: true }),
		);
	});

	it("completes zsh onboarding for an existing manual integration", async () => {
		// Given an existing manual wrapper and an rc file that initializes compinit.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const configDir = await mkdtemp(join(tmpdir(), "gji-config-"));
		const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));
		process.env.GJI_CONFIG_DIR = configDir;
		await writeFile(
			join(home, ".zshrc"),
			'autoload -Uz compinit && compinit -C\neval "$(gji init zsh)"\n',
			"utf8",
		);
		promptMocks.confirm.mockResolvedValueOnce(true);
		promptMocks.select
			.mockResolvedValueOnce("zsh")
			.mockResolvedValueOnce("__gji_skip_editor__");

		// When the default onboarding flow accepts completion setup.
		const result = await runInitCommand({
			cwd,
			home,
			interactive: true,
			stdout: () => undefined,
		});

		// Then it records integration and places the completion path before compinit.
		expect(result).toBe(0);
		const rcFile = await readFile(join(home, ".zshrc"), "utf8");
		expect(rcFile.indexOf("fpath=(~/.zsh/completions $fpath)")).toBeLessThan(
			rcFile.indexOf("compinit"),
		);
		expect(
			JSON.parse(await readFile(GLOBAL_CONFIG_FILE_PATH(home), "utf8")),
		).toEqual(expect.objectContaining({ shellIntegration: true }));
	});

	it("installs shell integration when a zsh comment mentions gji init", async () => {
		// Given a zsh rc file that only documents a disabled integration command.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const configDir = await mkdtemp(join(tmpdir(), "gji-config-"));
		const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));
		process.env.GJI_CONFIG_DIR = configDir;
		await writeFile(join(home, ".zshrc"), '# eval "$(gji init zsh)"\n', "utf8");
		promptMocks.confirm
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		promptMocks.select
			.mockResolvedValueOnce("zsh")
			.mockResolvedValueOnce("__gji_skip_editor__");

		// When the default onboarding flow approves integration and declines completion.
		const result = await runInitCommand({
			cwd,
			home,
			interactive: true,
			stdout: () => undefined,
		});

		// Then it installs a managed wrapper instead of treating the comment as active setup.
		expect(result).toBe(0);
		await expect(readFile(join(home, ".zshrc"), "utf8")).resolves.toContain(
			"# >>> gji shell integration >>>",
		);
	});

	it("keeps completed steps absent when onboarding is cancelled before a plan is returned", async () => {
		// Given an isolated home and an onboarding prompt that is cancelled immediately.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));
		const stderr: string[] = [];

		// When the no-argument onboarding flow receives a cancellation.
		const result = await runInitCommand({
			cwd,
			home,
			interactive: true,
			promptForOnboarding: async () => null,
			stderr: (chunk) => stderr.push(chunk),
			stdout: () => undefined,
		});

		// Then it exits non-zero without creating shell integration or global config files.
		expect(result).toBe(1);
		expect(stderr.join("")).toBe("Aborted.\n");
		await expect(readFile(join(home, ".zshrc"), "utf8")).rejects.toThrow();
		await expect(
			readFile(GLOBAL_CONFIG_FILE_PATH(home), "utf8"),
		).rejects.toThrow();
	});
});

describe("gji init --write setup wizard", () => {
	it("does not prompt for legacy setup in headless mode", async () => {
		// Given an explicit setup command with headless mode enabled.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));
		process.env.GJI_NO_TUI = "1";
		const promptForSetup = vi.fn(async () => ({
			installSaveTarget: "global" as const,
		}));

		// When the legacy write command runs.
		const result = await runInitCommand({
			cwd,
			home,
			promptForSetup,
			shell: "zsh",
			stdout: () => undefined,
			write: true,
		});

		// Then it writes the wrapper without invoking the interactive setup prompt.
		expect(result).toBe(0);
		expect(promptForSetup).not.toHaveBeenCalled();
		await expect(readFile(join(home, ".zshrc"), "utf8")).resolves.toContain(
			"# >>> gji init >>>",
		);
	});

	it("saves installSaveTarget and config values to global config", async () => {
		// Given an isolated home with no existing global config.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));

		// When gji init --write runs and the wizard returns global preferences.
		const result = await runInitCommand({
			cwd,
			home,
			shell: "zsh",
			write: true,
			stdout: () => undefined,
			promptForSetup: async () => ({
				installSaveTarget: "global",
				branchPrefix: "feat/",
				worktreePath: "~/worktrees",
				hooks: { "after-create": "pnpm install" },
			}),
		});

		// Then the values are written to global config.
		expect(result).toBe(0);
		const globalConfig = JSON.parse(
			await readFile(GLOBAL_CONFIG_FILE_PATH(home), "utf8"),
		) as Record<string, unknown>;
		expect(globalConfig.installSaveTarget).toBe("global");
		expect(globalConfig.branchPrefix).toBe("feat/");
		expect(globalConfig.worktreePath).toBe("~/worktrees");
		expect(globalConfig.hooks).toEqual({ "after-create": "pnpm install" });
		expect(globalConfig.shellIntegration).toBe(true);
	});

	it("saves config values to local .gji.json when installSaveTarget is local", async () => {
		// Given an isolated home and cwd.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));

		// When the wizard chooses local save target with a branch prefix.
		await runInitCommand({
			cwd,
			home,
			shell: "zsh",
			write: true,
			stdout: () => undefined,
			promptForSetup: async () => ({
				installSaveTarget: "local",
				branchPrefix: "fix/",
			}),
		});

		// Then branchPrefix is written to the local .gji.json.
		const localConfig = JSON.parse(
			await readFile(join(cwd, ".gji.json"), "utf8"),
		) as Record<string, unknown>;
		expect(localConfig.branchPrefix).toBe("fix/");
	});

	it("skips the wizard when shell integration is already configured", async () => {
		// Given a home where a previous gji init --write already ran.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));
		let wizardCallCount = 0;

		// First run sets shellIntegration: true.
		await runInitCommand({
			cwd,
			home,
			shell: "zsh",
			write: true,
			stdout: () => undefined,
			promptForSetup: async () => {
				wizardCallCount++;
				return { installSaveTarget: "global" };
			},
		});

		// Second run should skip the wizard.
		await runInitCommand({
			cwd,
			home,
			shell: "zsh",
			write: true,
			stdout: () => undefined,
			promptForSetup: async () => {
				wizardCallCount++;
				return { installSaveTarget: "global" };
			},
		});

		// Then the wizard was only called once (on first init).
		expect(wizardCallCount).toBe(1);
	});

	it("skips the wizard when not in --write mode", async () => {
		// Given an init run without --write (print-to-stdout mode).
		let wizardCalled = false;
		const stdout: string[] = [];

		// When gji init runs without --write.
		const result = await runInitCommand({
			cwd: "/tmp",
			home: "/tmp",
			shell: "zsh",
			stdout: (chunk) => stdout.push(chunk),
			promptForSetup: async () => {
				wizardCalled = true;
				return { installSaveTarget: "global" };
			},
		});

		// Then the shell script is printed and the wizard is not called.
		expect(result).toBe(0);
		expect(wizardCalled).toBe(false);
		expect(stdout.join("")).toContain("gji init");
	});

	it("does not save anything when the wizard is cancelled", async () => {
		// Given an isolated home with no existing global config.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));

		// When the wizard is cancelled (returns null).
		await runInitCommand({
			cwd,
			home,
			shell: "zsh",
			write: true,
			stdout: () => undefined,
			promptForSetup: async () => null,
		});

		// Then no config values are written (only shellIntegration is set).
		const globalConfig = JSON.parse(
			await readFile(GLOBAL_CONFIG_FILE_PATH(home), "utf8"),
		) as Record<string, unknown>;
		expect("installSaveTarget" in globalConfig).toBe(false);
		expect(globalConfig.shellIntegration).toBe(true);
	});

	it("sets shellIntegration: true in global config after writing", async () => {
		// Given an isolated home with no existing global config.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));

		// When gji init --write runs (no wizard needed).
		await runInitCommand({
			cwd,
			home,
			shell: "zsh",
			write: true,
			stdout: () => undefined,
			promptForSetup: async () => null,
		});

		// Then shellIntegration is marked as true.
		const globalConfig = JSON.parse(
			await readFile(GLOBAL_CONFIG_FILE_PATH(home), "utf8"),
		) as Record<string, unknown>;
		expect(globalConfig.shellIntegration).toBe(true);
	});
});

function expectedFishIntegration(): string {
	return `# >>> gji init >>>
function gji --wraps gji --description 'gji shell integration'
    if test (count $argv) -gt 0; and test $argv[1] = new
        set -e argv[1]
        if test (count $argv) -gt 0; and test $argv[1] = --help
            command gji new $argv
            return $status
        end

        set -l output_file (mktemp -t gji-new.XXXXXX)
        or return 1
        env GJI_NEW_OUTPUT_FILE=$output_file command gji new $argv
        or begin
            set -l status_code $status
            rm -f $output_file
            return $status_code
        end
        set -l target (cat $output_file)
        rm -f $output_file
        cd $target
        return $status
    end

    if test (count $argv) -gt 0; and test $argv[1] = pr
        set -e argv[1]
        if test (count $argv) -gt 0; and test $argv[1] = --help
            command gji pr $argv
            return $status
        end

        set -l output_file (mktemp -t gji-pr.XXXXXX)
        or return 1
        env GJI_PR_OUTPUT_FILE=$output_file command gji pr $argv
        or begin
            set -l status_code $status
            rm -f $output_file
            return $status_code
        end
        set -l target (cat $output_file)
        rm -f $output_file
        cd $target
        return $status
    end

    if test (count $argv) -gt 0; and test $argv[1] = back
        set -e argv[1]
        if test (count $argv) -gt 0; and test $argv[1] = --print
            command gji back $argv
            return $status
        end

        set -l output_file (mktemp -t gji-back.XXXXXX)
        or return 1
        env GJI_BACK_OUTPUT_FILE=$output_file command gji back $argv
        or begin
            set -l status_code $status
            rm -f $output_file
            return $status_code
        end
        set -l target (cat $output_file)
        rm -f $output_file
        cd $target
        return $status
    end

    if test (count $argv) -gt 0; and begin; test $argv[1] = go; or test $argv[1] = jump; end
        set -e argv[1]
        if test (count $argv) -gt 0; and test $argv[1] = --print
            command gji go $argv
            return $status
        end

        set -l output_file (mktemp -t gji-go.XXXXXX)
        or return 1
        env GJI_GO_OUTPUT_FILE=$output_file command gji go $argv
        or begin
            set -l status_code $status
            rm -f $output_file
            return $status_code
        end
        set -l target (cat $output_file)
        rm -f $output_file
        cd $target
        return $status
    end

    if test (count $argv) -gt 0; and test $argv[1] = root
        set -e argv[1]
        if test (count $argv) -gt 0; and test $argv[1] = --print
            command gji root $argv
            return $status
        end

        set -l output_file (mktemp -t gji-root.XXXXXX)
        or return 1
        env GJI_ROOT_OUTPUT_FILE=$output_file command gji root $argv
        or begin
            set -l status_code $status
            rm -f $output_file
            return $status_code
        end
        set -l target (cat $output_file)
        rm -f $output_file
        cd $target
        return $status
    end

    if test (count $argv) -gt 0; and begin; test $argv[1] = remove; or test $argv[1] = rm; end
        set -e argv[1]
        if test (count $argv) -gt 0; and test $argv[1] = --help
            command gji remove $argv
            return $status
        end

        set -l output_file (mktemp -t gji-remove.XXXXXX)
        or return 1
        env GJI_REMOVE_OUTPUT_FILE=$output_file command gji remove $argv
        or begin
            set -l status_code $status
            rm -f $output_file
            return $status_code
        end
        set -l target (cat $output_file)
        rm -f $output_file
        cd $target
        return $status
    end

    if test (count $argv) -gt 0; and test $argv[1] = warp
        set -e argv[1]
        if test (count $argv) -gt 0; and begin; test $argv[1] = --print; or test $argv[1] = --json; end
            command gji warp $argv
            return $status
        end

        set -l output_file (mktemp -t gji-warp.XXXXXX)
        or return 1
        env GJI_WARP_OUTPUT_FILE=$output_file command gji warp $argv
        or begin
            set -l status_code $status
            rm -f $output_file
            return $status_code
        end
        set -l target (cat $output_file)
        rm -f $output_file
        cd $target
        return $status
    end

    command gji $argv
end
# <<< gji init <<<
`;
}
