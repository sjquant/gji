import { execFile as execFileCallback, spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { runInitCommand } from "./init.js";

const originalShell = process.env.SHELL;
const execFile = promisify(execFileCallback);
const zshExecutable = findZshExecutable();

afterEach(() => {
	if (originalShell === undefined) {
		delete process.env.SHELL;
	} else {
		process.env.SHELL = originalShell;
	}
});

describe("gji completion", () => {
	it("prints zsh completions explicitly", async () => {
		// Given a command output collector.
		const stdout: string[] = [];

		// When gji completion runs for zsh explicitly.
		const result = await runCli(["completion", "zsh"], {
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints the zsh completion definition without the init wrapper.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toContain("#compdef gji");
		expect(stdout.join("")).toContain(
			"'completion:print shell completion definitions'",
		);
		expect(stdout.join("")).toContain(
			"'doctor:check gji installation and configuration health'",
		);
		expect(stdout.join("")).toContain(
			"'back:navigate to the previously visited worktree'",
		);
		expect(stdout.join("")).toContain("'history:show navigation history'");
		expect(stdout.join("")).toContain("'open:open the worktree in an editor'");
		expect(stdout.join("")).toContain("'jump:alias of go'");
		expect(stdout.join("")).toContain(
			"'sync-files:manage local files copied into new worktrees'",
		);
		expect(stdout.join("")).toContain(
			"'warp:deprecated: use go (press Tab for all known repos)'",
		);
		expect(stdout.join("")).toContain("'2:shell:(bash fish zsh)'");
		expect(stdout.join("")).toContain(
			"'--json[emit diagnostic checks as JSON]'",
		);
		expect(stdout.join("")).toContain(
			"'--force[remove and recreate the worktree if the target path already exists]'",
		);
		expect(stdout.join("")).toContain(
			"'--from-current[base the new branch on the current worktree instead of the main worktree]'",
		);
		expect(stdout.join("")).toContain(
			"'--editor[editor CLI to use with --open (code, cursor, zed, …)]:editor:'",
		);
		expect(stdout.join("")).toContain(
			"'--workspace[generate a .code-workspace file before opening (VS Code / Cursor / Windsurf)]'",
		);
		expect(stdout.join("")).toContain(
			"'--select[choose a worktree with the interactive selector]'",
		);
		expect(stdout.join("")).not.toContain(
			"create a new worktree in a registered repo",
		);
		expect(stdout.join("")).not.toContain(
			"create a new worktree in the current repository",
		);
		expect(stdout.join("")).toContain("'2:branch:->worktrees'");
		expect(stdout.join("")).toContain("command gji ls --compact");
		expect(stdout.join("")).toContain("branch or PR number:->pr_targets");
		expect(stdout.join("")).toContain(
			"'--select[choose a pull request from any linked worktree]'",
		);
		expect(stdout.join("")).toContain("'2:ref:(open)'");
		expect(stdout.join("")).toContain("__gji_pr_targets");
		expect(stdout.join("")).toContain("__gji_pr_targets_cache");
		expect(stdout.join("")).toContain("__gji_pr_targets_cache_repo");
		expect(stdout.join("")).toContain("__gji_run_bounded");
		expect(stdout.join("")).toContain(
			"sed -n 's/.*\"number\":[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p'",
		);
		expect(stdout.join("")).toContain(`\${words[(I)--select]}`);
		expect(stdout.join("")).toContain("command_entries");
		expect(stdout.join("")).toContain('branch = ($1 == "*" ? $2 : $1)');
		expect(stdout.join("")).toContain("_values 'config action' get set unset");
		expect(stdout.join("")).toContain(
			"_values 'config key' branchPrefix editor hooks installSaveTarget shellIntegration skipInstallPrompt syncDefaultBranch syncFiles syncRemote worktreePath repos",
		);
		expect(stdout.join("")).toContain(`case "\${words[3]}" in`);
		expect(stdout.join("")).toContain("get|unset)");
		expect(stdout.join("")).toContain("_arguments '3:key:->config_keys'");
		expect(stdout.join("")).toContain("set)");
		expect(stdout.join("")).toContain(
			"_arguments '3:key:->config_keys' '4:value: '",
		);
		expect(stdout.join("")).not.toContain(
			"'2:action:(get set unset)' '3:key:->config_keys' '4:value: '",
		);
		expect(stdout.join("")).toContain("__gji_worktree_branches() {");
		expect(stdout.join("")).toContain(
			"'--select[choose a worktree with the interactive selector]'",
		);
		expect(stdout.join("")).not.toContain("compdef _gji_completion gji");
		expect(stdout.join("")).not.toContain("# >>> gji init >>>");
		expect(stdout.join("")).not.toContain("gji() {");
	});

	it("rejects an explicitly unsupported shell", async () => {
		// Given an output collector for completion errors.
		const stderr: string[] = [];

		// When gji completion is invoked for an unsupported shell.
		const result = await runCli(["completion", "powershell"], {
			stderr: (chunk) => stderr.push(chunk),
		});

		// Then it identifies the requested shell and lists supported choices.
		expect(result.exitCode).toBe(1);
		expect(stderr.join("")).toBe(
			'Unsupported shell "powershell". Supported shells: bash, fish, or zsh.\n',
		);
	});

	it.skipIf(zshExecutable === undefined)(
		"registers zsh completions through compinit when installed as _gji",
		async () => {
			// Given the generated zsh completion file installed into a temporary fpath entry.
			const stdout: string[] = [];
			const completionDirectory = await mkdtemp(
				join(tmpdir(), "gji-zsh-completion-"),
			);
			const completionPath = join(completionDirectory, "_gji");
			const registrationScript = join(
				completionDirectory,
				"check-registration.zsh",
			);

			const result = await runCli(["completion", "zsh"], {
				stdout: (chunk) => stdout.push(chunk),
			});

			await writeFile(completionPath, stdout.join(""), "utf8");
			await writeFile(
				registrationScript,
				`fpath=(${completionDirectory} $fpath)
autoload -Uz compinit && compinit
print -r -- "\${_comps[gji]-unset}"`,
				"utf8",
			);

			// When zsh loads the completion directory through compinit.
			const registrationResult = await execFile(
				zshExecutable as string,
				["-f", registrationScript],
				{
					env: {
						...process.env,
						HOME: completionDirectory,
					},
				},
			);

			// Then gji is mapped to the installed _gji completion.
			expect(result.exitCode).toBe(0);
			expect(registrationResult.stdout.trim()).toBe("_gji");
		},
	);

	it.skipIf(zshExecutable === undefined)(
		"registers onboarding completions for a manual zsh integration after compinit",
		async () => {
			// Given a manual integration after an rc file's existing compinit setup.
			const home = await mkdtemp(join(tmpdir(), "gji-home-"));
			const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));
			const rcPath = join(home, ".zshrc");
			const registrationScript = join(
				home,
				"check-onboarding-registration.zsh",
			);
			await writeFile(
				rcPath,
				'autoload -Uz compinit && compinit -C\neval "$(gji init zsh)"\n',
				"utf8",
			);

			// When onboarding adds completion to the detected existing integration.
			const result = await runInitCommand({
				cwd,
				home,
				interactive: true,
				promptForOnboarding: async () => ({
					installCompletion: true,
					shellIntegration: "existing",
					shell: "zsh",
				}),
				stdout: () => undefined,
			});
			await writeFile(
				registrationScript,
				`gji() { :; }
source "${rcPath}"
print -r -- "\${_comps[gji]-unset}"`,
				"utf8",
			);
			const environment = { ...process.env };
			delete environment.FPATH;

			// Then zsh maps gji to the installed completion function.
			const registrationResult = await execFile(
				zshExecutable as string,
				["-f", registrationScript],
				{ env: { ...environment, HOME: home } },
			);
			expect(result).toBe(0);
			expect(registrationResult.stdout.trim()).toBe("_gji");
		},
	);

	it.skipIf(zshExecutable === undefined)(
		"registers onboarding completions when a sourced zsh framework runs compinit",
		async () => {
			// Given a manual integration after a sourced framework that initializes compinit.
			const home = await mkdtemp(join(tmpdir(), "gji-home-"));
			const cwd = await mkdtemp(join(tmpdir(), "gji-cwd-"));
			const frameworkPath = join(home, "framework.zsh");
			const rcPath = join(home, ".zshrc");
			const registrationScript = join(home, "check-framework-registration.zsh");
			await writeFile(
				frameworkPath,
				"autoload -Uz compinit && compinit -C\n",
				"utf8",
			);
			await writeFile(
				rcPath,
				`source "${frameworkPath}"\neval "$(gji init zsh)"\n`,
				"utf8",
			);

			// When onboarding adds completion to the detected existing integration.
			const result = await runInitCommand({
				cwd,
				home,
				interactive: true,
				promptForOnboarding: async () => ({
					installCompletion: true,
					shellIntegration: "existing",
					shell: "zsh",
				}),
				stdout: () => undefined,
			});
			await writeFile(
				registrationScript,
				`gji() { :; }
source "${rcPath}"
print -r -- "\${_comps[gji]-unset}"`,
				"utf8",
			);
			const environment = { ...process.env };
			delete environment.FPATH;

			// Then zsh maps gji to the installed completion function.
			const registrationResult = await execFile(
				zshExecutable as string,
				["-f", registrationScript],
				{ env: { ...environment, HOME: home } },
			);
			expect(result).toBe(0);
			expect(registrationResult.stdout.trim()).toBe("_gji");
		},
	);

	it("auto-detects the shell from SHELL when no shell is provided", async () => {
		// Given a fish SHELL environment and a command output collector.
		const stdout: string[] = [];
		process.env.SHELL = "/opt/homebrew/bin/fish";

		// When gji completion runs without an explicit shell argument.
		const result = await runCli(["completion"], {
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it prints the detected fish completion definition.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toContain("function __gji_worktree_branches");
		expect(stdout.join("")).toContain("command gji ls --compact");
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_seen_subcommand_from pr' -a 'open'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__gji_should_complete_pr_select' -l select",
		);
		expect(stdout.join("")).toContain("__gji_should_complete_pr_target");
		expect(stdout.join("")).toContain("__gji_should_complete_pr_select");
		expect(stdout.join("")).toContain("test (commandline -opc)[3] != open");
		expect(stdout.join("")).toContain("__gji_pr_targets");
		expect(stdout.join("")).toContain('branch = ($1 == "*" ? $2 : $1)');
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_seen_subcommand_from completion' -a 'zsh'",
		);
		expect(stdout.join("")).toContain(
			"function __gji_should_complete_config_action",
		);
		expect(stdout.join("")).toContain(
			"function __gji_should_complete_config_key",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_use_subcommand' -a 'back'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_use_subcommand' -a 'open'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_use_subcommand' -a 'jump'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_use_subcommand' -a 'sync-files'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_seen_subcommand_from sync-files' -a 'list add remove rm'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_use_subcommand' -a 'warp'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_seen_subcommand_from new' -l force",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_seen_subcommand_from new' -l from-current",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_seen_subcommand_from new' -l editor -r",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_seen_subcommand_from open' -l workspace",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_seen_subcommand_from open' -l select",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_seen_subcommand_from go jump' -a '(__gji_worktree_branches)'",
		);
		expect(stdout.join("")).not.toContain(
			"__fish_seen_subcommand_from warp' -s n -l new",
		);
		expect(stdout.join("")).toContain("test (count $tokens) -eq 2");
		expect(stdout.join("")).toContain("if test (count $tokens) -ne 3");
		expect(stdout.join("")).toContain("if test $tokens[2] != config");
		expect(stdout.join("")).toContain("contains -- $tokens[3] get set unset");
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_seen_subcommand_from config; and __gji_should_complete_config_action' -a 'get set unset' -d 'config action'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__gji_should_complete_config_key' -a 'branchPrefix' -d 'config key'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__gji_should_complete_config_key' -a 'editor' -d 'config key'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__gji_should_complete_config_key' -a 'shellIntegration' -d 'config key'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__gji_should_complete_config_key' -a 'worktreePath' -d 'config key'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__gji_should_complete_config_key' -a 'repos' -d 'config key'",
		);
		expect(stdout.join("")).not.toContain(
			"__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set unset",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_use_subcommand' -a 'new'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_use_subcommand' -a 'doctor'",
		);
		expect(stdout.join("")).toContain(
			"complete -c gji -n '__fish_seen_subcommand_from doctor' -l json",
		);
	});

	it("prints bash config completions with a separate free-form value slot", async () => {
		// Given a command output collector.
		const stdout: string[] = [];

		// When gji completion runs for bash explicitly.
		const result = await runCli(["completion", "bash"], {
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then config completions only suggest keys in the key position.
		expect(result.exitCode).toBe(0);
		expect(stdout.join("")).toContain("command gji ls --compact");
		expect(stdout.join("")).toContain('branch = ($1 == "*" ? $2 : $1)');
		expect(stdout.join("")).toContain("back history open go jump");
		expect(stdout.join("")).toContain("doctor");
		expect(stdout.join("")).toContain("sync-files");
		expect(stdout.join("")).toContain("list add remove rm --json --help");
		expect(stdout.join("")).toContain(
			"--detached --from-current --take --copy --force",
		);
		expect(stdout.join("")).toContain("--force --open --editor");
		expect(stdout.join("")).toContain("go|jump)");
		expect(stdout.join("")).toContain("open --dry-run --json --help");
		expect(stdout.join("")).toContain("local has_select=0 has_target=0 word");
		expect(stdout.join("")).toContain("has_target=0");
		expect(stdout.join("")).toContain("__gji_run_bounded");
		expect(stdout.join("")).toContain("$(__gji_pr_targets) --select --help");
		expect(stdout.join("")).toContain("__gji_pr_targets");
		expect(stdout.join("")).toContain("open)");
		expect(stdout.join("")).toContain(
			"--editor --select --save --workspace --help",
		);
		expect(stdout.join("")).toContain("warp)");
		expect(stdout.join("")).toContain("doctor)");
		expect(stdout.join("")).toContain("shellIntegration");
		expect(stdout.join("")).toContain("worktreePath");
		expect(stdout.join("")).toContain("repos");
		expect(stdout.join("")).toContain('if [ "$COMP_CWORD" -eq 2 ]; then');
		expect(stdout.join("")).toContain("get|unset)");
		expect(stdout.join("")).toContain("set)");
		expect(stdout.join("")).toContain('if [ "$COMP_CWORD" -eq 3 ]; then');
		expect(stdout.join("")).not.toContain(
			"get|set|unset)\n          COMPREPLY=( $(compgen -W",
		);
	});
});

function findZshExecutable(): string | undefined {
	const shellFromEnv = process.env.SHELL;

	if (shellFromEnv) {
		const probe = spawnSync(shellFromEnv, ["-lc", "command -v zsh"], {
			encoding: "utf8",
		});
		const resolvedPath = probe.stdout.trim();

		if (probe.status === 0 && resolvedPath.length > 0) {
			return resolvedPath;
		}
	}

	const fallbackProbe = spawnSync("sh", ["-lc", "command -v zsh"], {
		encoding: "utf8",
	});
	const fallbackPath = fallbackProbe.stdout.trim();

	return fallbackProbe.status === 0 && fallbackPath.length > 0
		? fallbackPath
		: undefined;
}
