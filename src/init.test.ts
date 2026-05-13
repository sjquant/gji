import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { GLOBAL_CONFIG_FILE_PATH } from "./config.js";
import { runInitCommand } from "./init.js";

const originalHome = process.env.HOME;
const originalShell = process.env.SHELL;

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

	it("auto-detects the shell from SHELL when no shell is provided", async () => {
		// Given a zsh SHELL environment and a command output collector.
		const stdout: string[] = [];
		process.env.SHELL = "/bin/zsh";

		// When gji init runs without an explicit shell argument.
		const result = await runCli(["init"], {
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints the detected shell integration wrapper without bundled completions.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toContain("gji() {");
		expect(stdout.join("")).not.toContain("compdef _gji_completion gji");
	});

	it("auto-detects fish from SHELL when no shell is provided", async () => {
		// Given a fish SHELL environment and a command output collector.
		const stdout: string[] = [];
		process.env.SHELL = "/opt/homebrew/bin/fish";

		// When gji init runs without an explicit shell argument.
		const result = await runCli(["init"], {
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints the detected shell integration wrapper.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toBe(expectedFishIntegration());
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

describe("gji init --write setup wizard", () => {
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
				hooks: { afterCreate: "pnpm install" },
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
		expect(globalConfig.hooks).toEqual({ afterCreate: "pnpm install" });
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
