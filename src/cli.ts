import { createRequire } from "node:module";
import { Command } from "commander";
import updateNotifier from "update-notifier";

import { runBackCommand } from "./back.js";
import { runCleanCommand } from "./clean.js";
import { runCompletionCommand } from "./completion.js";
import { runConfigCommand } from "./config-command.js";
import { runGoCommand } from "./go.js";
import { isHeadless } from "./headless.js";
import { runHistoryCommand } from "./history-command.js";
import { runInitCommand } from "./init.js";
import { runLsCommand } from "./ls.js";
import { runNewCommand } from "./new.js";
import { runOpenCommand } from "./open.js";
import { runPrCommand } from "./pr.js";
import { runRemoveCommand } from "./remove.js";
import { detectRepository } from "./repo.js";
import { registerRepo } from "./repo-registry.js";
import { runRootCommand } from "./root.js";
import { runStatusCommand } from "./status.js";
import { runSyncCommand } from "./sync.js";
import { runSyncFilesCommand } from "./sync-files-command.js";
import { runTriggerHookCommand } from "./trigger-hook.js";
import { runWarpCommand } from "./warp.js";

interface PackageMetadata {
	name: string;
	version: string;
}

export interface RunCliOptions {
	cwd?: string;
	stderr?: (chunk: string) => void;
	stdout?: (chunk: string) => void;
}

export interface RunCliResult {
	exitCode: number;
}

interface CommandActionOptions {
	cwd: string;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export function createProgram(): Command {
	const program = new Command();
	const packageMetadata = readPackageMetadata();

	program
		.name("gji")
		.description("Context switching without the mess.")
		.version(packageMetadata.version)
		.showHelpAfterError()
		.showSuggestionAfterError();

	registerCommands(program);

	return program;
}

function readPackageMetadata(): PackageMetadata {
	const require = createRequire(import.meta.url);
	const packageJson = require("../package.json") as {
		name?: unknown;
		version?: unknown;
	};

	return {
		name: typeof packageJson.name === "string" ? packageJson.name : "gji",
		version:
			typeof packageJson.version === "string" ? packageJson.version : "0.0.0",
	};
}

export async function runCli(
	argv: string[],
	options: RunCliOptions = {},
): Promise<RunCliResult> {
	await maybeNotifyForUpdates(argv);
	maybeRegisterCurrentRepo(options.cwd ?? process.cwd());

	const program = createProgram();
	const cwd = options.cwd ?? process.cwd();
	const stdout = options.stdout ?? (() => undefined);
	const stderr = options.stderr ?? (() => undefined);

	program.configureOutput({
		writeErr: stderr,
		writeOut: stdout,
	});
	program.exitOverride();

	if (argv.length === 0) {
		program.outputHelp();

		return { exitCode: 0 };
	}

	try {
		attachCommandActions(program, { cwd, stderr, stdout });
		await program.parseAsync(["node", "gji", ...argv], { from: "node" });

		return { exitCode: 0 };
	} catch (error) {
		if (isCommanderExit(error)) {
			return { exitCode: error.exitCode };
		}

		throw error;
	}
}

async function maybeNotifyForUpdates(argv: string[]): Promise<void> {
	if (shouldSkipUpdateNotification(argv)) {
		return;
	}

	try {
		defaultNotifyForUpdates(readPackageMetadata());
	} catch {
		// Ignore notifier failures so startup behaviour stays stable.
	}
}

function shouldSkipUpdateNotification(argv: string[]): boolean {
	return (
		argv.length === 0 ||
		argv.includes("--json") ||
		argv.some(isHelpOrVersionArgument) ||
		isHeadless() ||
		process.stdout.isTTY !== true ||
		process.stderr.isTTY !== true
	);
}

function isHelpOrVersionArgument(argument: string): boolean {
	return (
		argument === "--help" ||
		argument === "-h" ||
		argument === "help" ||
		argument === "--version" ||
		argument === "-V"
	);
}

function defaultNotifyForUpdates(pkg: PackageMetadata): void {
	const notifier = updateNotifier({ pkg });

	notifier.notify();
}

function maybeRegisterCurrentRepo(cwd: string): void {
	detectRepository(cwd)
		.then(({ repoRoot }) => registerRepo(repoRoot))
		.catch(() => undefined);
}

function registerCommands(program: Command): void {
	program
		.command("new [branch]")
		.description("create a new branch or detached linked worktree")
		.option(
			"-f, --force",
			"remove and recreate the worktree if the target path already exists",
		)
		.option("--detached", "create a detached worktree without a branch")
		.option("--open", "open the new worktree in an editor after creation")
		.option(
			"--editor <cli>",
			"editor CLI to use with --open (code, cursor, zed, …)",
		)
		.option(
			"--dry-run",
			"show what would be created without executing any git commands or writing files",
		)
		.option(
			"--json",
			"emit JSON on success or error instead of human-readable output",
		)
		.action(notImplemented("new"));

	program
		.command("init [shell]")
		.description("print or install shell integration")
		.option("--write", "write the integration to the shell config file")
		.action(notImplemented("init"));

	program
		.command("completion [shell]")
		.description("print shell completion definitions")
		.action(notImplemented("completion"));

	program
		.command("pr <ref>")
		.description(
			"fetch a pull request by number, #number, or URL into a linked worktree",
		)
		.option(
			"--dry-run",
			"show what would be created without executing any git commands or writing files",
		)
		.option(
			"--json",
			"emit JSON on success or error instead of human-readable output",
		)
		.action(notImplemented("pr"));

	program
		.command("back [n]")
		.description(
			"navigate to the previously visited worktree, optionally N steps back",
		)
		.option("--print", "print the resolved worktree path explicitly")
		.action(notImplemented("back"));

	program
		.command("history")
		.description("show navigation history")
		.option("--json", "print history as JSON")
		.action(notImplemented("history"));

	program
		.command("open [branch]")
		.description("open the worktree in an editor")
		.option(
			"--editor <cli>",
			"editor CLI to use (code, cursor, zed, windsurf, subl, …)",
		)
		.option("--save", "save the chosen editor to global config")
		.option(
			"--workspace",
			"generate a .code-workspace file before opening (VS Code / Cursor / Windsurf)",
		)
		.action(notImplemented("open"));

	program
		.command("go [branch]")
		.alias("jump")
		.description("print or select a worktree path")
		.option("--print", "print the resolved worktree path explicitly")
		.action(notImplemented("go"));

	program
		.command("root")
		.description("print the main repository root path")
		.option("--print", "print the resolved repository root path explicitly")
		.action(notImplemented("root"));

	program
		.command("status")
		.description("summarize repository and worktree health")
		.option("--json", "print repository and worktree health as JSON")
		.action(notImplemented("status"));

	program
		.command("sync")
		.description("fetch and update one or all worktrees")
		.option("--all", "sync every worktree in the repository")
		.option(
			"--json",
			"emit JSON on success or error instead of human-readable output",
		)
		.action(notImplemented("sync"));

	const syncFilesCommand = program
		.command("sync-files")
		.description("manage local files copied into new worktrees")
		.option("--json", "emit JSON instead of human-readable output")
		.action(notImplemented("sync-files"));

	syncFilesCommand
		.command("list")
		.description("list files synced into new worktrees for this repo")
		.option("--json", "emit JSON instead of human-readable output")
		.action(notImplemented("sync-files list"));

	syncFilesCommand
		.command("add <paths...>")
		.description("add repo-local sync files to global config")
		.option("--json", "emit JSON instead of human-readable output")
		.action(notImplemented("sync-files add"));

	syncFilesCommand
		.command("remove <paths...>")
		.alias("rm")
		.description("remove repo-local sync files from global config")
		.option("--json", "emit JSON instead of human-readable output")
		.action(notImplemented("sync-files remove"));

	program
		.command("ls")
		.description("list active worktrees")
		.option("--compact", "show only branch and path columns")
		.option("--json", "print active worktrees as JSON")
		.action(notImplemented("ls"));

	program
		.command("clean")
		.description("interactively prune linked worktrees")
		.option(
			"-f, --force",
			"bypass prompts, force-remove dirty worktrees, and force-delete unmerged branches",
		)
		.option(
			"--stale",
			"only target clean worktrees whose upstream is gone and branch is merged into the default branch",
		)
		.option("--dry-run", "show what would be deleted without removing anything")
		.option(
			"--json",
			"emit JSON on success or error instead of human-readable output",
		)
		.action(notImplemented("clean"));

	program
		.command("remove [branch]")
		.alias("rm")
		.description("remove a linked worktree and delete its branch when present")
		.option(
			"-f, --force",
			"bypass prompts, force-remove a dirty worktree, and force-delete an unmerged branch",
		)
		.option("--dry-run", "show what would be deleted without removing anything")
		.option(
			"--json",
			"emit JSON on success or error instead of human-readable output",
		)
		.action(notImplemented("remove"));

	program
		.command("trigger-hook <hook>")
		.description(
			"run a named hook (afterCreate, afterEnter, beforeRemove) in the current worktree",
		)
		.action(notImplemented("trigger-hook"));

	program
		.command("warp [branch]")
		.description("jump to any worktree across all known repos")
		.option("-n, --new [branch]", "create a new worktree in a registered repo")
		// --print is the shell-wrapper bypass signal (see SHELL_WRAPPED_COMMANDS in init.ts).
		// The shell omits GJI_WARP_OUTPUT_FILE, so writeShellOutput falls through to stdout.
		.option(
			"--print",
			"print the resolved worktree path without changing directory",
		)
		.option(
			"--json",
			"emit JSON on success or error instead of human-readable output",
		)
		.action(notImplemented("warp"));

	const configCommand = program
		.command("config")
		.description("manage global config defaults")
		.action(notImplemented("config"));

	configCommand
		.command("get [key]")
		.description("print the global config or a single key")
		.action(notImplemented("config get"));

	configCommand
		.command("set <key> <value>")
		.description("set a global config value")
		.action(notImplemented("config set"));

	configCommand
		.command("unset <key>")
		.description("remove a global config value")
		.action(notImplemented("config unset"));
}

function attachCommandActions(
	program: Command,
	options: CommandActionOptions,
): void {
	program.commands
		.find((command) => command.name() === "new")
		?.action(
			async (
				branch: string | undefined,
				commandOptions: {
					detached?: boolean;
					dryRun?: boolean;
					editor?: string;
					force?: boolean;
					json?: boolean;
					open?: boolean;
				},
			) => {
				const exitCode = await runNewCommand({
					...options,
					branch,
					detached: commandOptions.detached,
					dryRun: commandOptions.dryRun,
					editor: commandOptions.editor,
					force: commandOptions.force,
					json: commandOptions.json,
					open: commandOptions.open,
				});

				if (exitCode !== 0) {
					throw commanderExit(exitCode);
				}
			},
		);

	program.commands
		.find((command) => command.name() === "init")
		?.action(
			async (
				shell: string | undefined,
				commandOptions: { write?: boolean },
			) => {
				const exitCode = await runInitCommand({
					cwd: options.cwd,
					shell,
					stderr: options.stderr,
					stdout: options.stdout,
					write: commandOptions.write,
				});

				if (exitCode !== 0) {
					throw commanderExit(exitCode);
				}
			},
		);

	program.commands
		.find((command) => command.name() === "completion")
		?.action(async (shell: string | undefined) => {
			const exitCode = await runCompletionCommand({
				shell,
				stderr: options.stderr,
				stdout: options.stdout,
			});

			if (exitCode !== 0) {
				throw commanderExit(exitCode);
			}
		});

	program.commands
		.find((command) => command.name() === "pr")
		?.action(
			async (
				number: string,
				commandOptions: { dryRun?: boolean; json?: boolean },
			) => {
				const exitCode = await runPrCommand({
					cwd: options.cwd,
					dryRun: commandOptions.dryRun,
					json: commandOptions.json,
					number,
					stderr: options.stderr,
					stdout: options.stdout,
				});

				if (exitCode !== 0) {
					throw commanderExit(exitCode);
				}
			},
		);

	program.commands
		.find((command) => command.name() === "back")
		?.action(
			async (n: string | undefined, commandOptions: { print?: boolean }) => {
				if (n !== undefined && !/^\d+$/.test(n)) {
					options.stderr(`gji back: invalid step count: ${n}\n`);
					throw commanderExit(1);
				}
				const steps = n !== undefined ? parseInt(n, 10) : undefined;
				const exitCode = await runBackCommand({
					cwd: options.cwd,
					n: steps,
					print: commandOptions.print,
					stderr: options.stderr,
					stdout: options.stdout,
				});

				if (exitCode !== 0) {
					throw commanderExit(exitCode);
				}
			},
		);

	program.commands
		.find((command) => command.name() === "history")
		?.action(async (commandOptions: { json?: boolean }) => {
			const exitCode = await runHistoryCommand({
				cwd: options.cwd,
				json: commandOptions.json,
				stdout: options.stdout,
			});

			if (exitCode !== 0) {
				throw commanderExit(exitCode);
			}
		});

	program.commands
		.find((command) => command.name() === "open")
		?.action(
			async (
				branch: string | undefined,
				commandOptions: {
					editor?: string;
					save?: boolean;
					workspace?: boolean;
				},
			) => {
				const exitCode = await runOpenCommand({
					branch,
					cwd: options.cwd,
					editor: commandOptions.editor,
					save: commandOptions.save,
					stderr: options.stderr,
					stdout: options.stdout,
					workspace: commandOptions.workspace,
				});

				if (exitCode !== 0) {
					throw commanderExit(exitCode);
				}
			},
		);

	program.commands
		.find((command) => command.name() === "go")
		?.action(
			async (
				branch: string | undefined,
				commandOptions: { print?: boolean },
			) => {
				const exitCode = await runGoCommand({
					branch,
					cwd: options.cwd,
					print: commandOptions.print,
					stderr: options.stderr,
					stdout: options.stdout,
				});

				if (exitCode !== 0) {
					throw commanderExit(exitCode);
				}
			},
		);

	program.commands
		.find((command) => command.name() === "root")
		?.action(async (commandOptions: { print?: boolean }) => {
			const exitCode = await runRootCommand({
				cwd: options.cwd,
				print: commandOptions.print,
				stdout: options.stdout,
			});

			if (exitCode !== 0) {
				throw commanderExit(exitCode);
			}
		});

	program.commands
		.find((command) => command.name() === "status")
		?.action(async (commandOptions: { json?: boolean }) => {
			const exitCode = await runStatusCommand({
				cwd: options.cwd,
				json: commandOptions.json,
				stdout: options.stdout,
			});

			if (exitCode !== 0) {
				throw commanderExit(exitCode);
			}
		});

	program.commands
		.find((command) => command.name() === "sync")
		?.action(async (commandOptions: { all?: boolean; json?: boolean }) => {
			const exitCode = await runSyncCommand({
				all: commandOptions.all,
				cwd: options.cwd,
				json: commandOptions.json,
				stderr: options.stderr,
				stdout: options.stdout,
			});

			if (exitCode !== 0) {
				throw commanderExit(exitCode);
			}
		});

	const syncFilesCommand = program.commands.find(
		(command) => command.name() === "sync-files",
	);

	syncFilesCommand?.action(async (commandOptions: { json?: boolean }) => {
		const exitCode = await runSyncFilesCommand({
			action: "list",
			cwd: options.cwd,
			json: commandOptions.json,
			stderr: options.stderr,
			stdout: options.stdout,
		});

		if (exitCode !== 0) {
			throw commanderExit(exitCode);
		}
	});

	syncFilesCommand?.commands
		.find((command) => command.name() === "list")
		?.action(async (commandOptions: { json?: boolean }) => {
			const exitCode = await runSyncFilesCommand({
				action: "list",
				cwd: options.cwd,
				json: commandOptions.json || syncFilesCommand?.opts().json,
				stderr: options.stderr,
				stdout: options.stdout,
			});

			if (exitCode !== 0) {
				throw commanderExit(exitCode);
			}
		});

	syncFilesCommand?.commands
		.find((command) => command.name() === "add")
		?.action(async (paths: string[], commandOptions: { json?: boolean }) => {
			const exitCode = await runSyncFilesCommand({
				action: "add",
				cwd: options.cwd,
				json: commandOptions.json || syncFilesCommand?.opts().json,
				paths,
				stderr: options.stderr,
				stdout: options.stdout,
			});

			if (exitCode !== 0) {
				throw commanderExit(exitCode);
			}
		});

	const runSyncFilesRemoveCommand = async (
		paths: string[],
		commandOptions: { json?: boolean },
	) => {
		const exitCode = await runSyncFilesCommand({
			action: "remove",
			cwd: options.cwd,
			json: commandOptions.json || syncFilesCommand?.opts().json,
			paths,
			stderr: options.stderr,
			stdout: options.stdout,
		});

		if (exitCode !== 0) {
			throw commanderExit(exitCode);
		}
	};

	syncFilesCommand?.commands
		.find((command) => command.name() === "remove")
		?.action(runSyncFilesRemoveCommand);

	program.commands
		.find((command) => command.name() === "ls")
		?.action(async (commandOptions: { compact?: boolean; json?: boolean }) => {
			const exitCode = await runLsCommand({
				compact: commandOptions.compact,
				cwd: options.cwd,
				json: commandOptions.json,
				stdout: options.stdout,
			});

			if (exitCode !== 0) {
				throw commanderExit(exitCode);
			}
		});

	program.commands
		.find((command) => command.name() === "clean")
		?.action(
			async (commandOptions: {
				dryRun?: boolean;
				force?: boolean;
				json?: boolean;
				stale?: boolean;
			}) => {
				const exitCode = await runCleanCommand({
					cwd: options.cwd,
					dryRun: commandOptions.dryRun,
					force: commandOptions.force,
					json: commandOptions.json,
					stale: commandOptions.stale,
					stderr: options.stderr,
					stdout: options.stdout,
				});

				if (exitCode !== 0) {
					throw commanderExit(exitCode);
				}
			},
		);

	const runRemovalCommand = async (
		branch?: string,
		commandOptions: { dryRun?: boolean; force?: boolean; json?: boolean } = {},
	) => {
		const exitCode = await runRemoveCommand({
			branch,
			cwd: options.cwd,
			dryRun: commandOptions.dryRun,
			force: commandOptions.force,
			json: commandOptions.json,
			stderr: options.stderr,
			stdout: options.stdout,
		});

		if (exitCode !== 0) {
			throw commanderExit(exitCode);
		}
	};

	program.commands
		.find((command) => command.name() === "remove")
		?.action(runRemovalCommand);

	program.commands
		.find((command) => command.name() === "trigger-hook")
		?.action(async (hook: string) => {
			const exitCode = await runTriggerHookCommand({
				cwd: options.cwd,
				hook,
				stderr: options.stderr,
			});

			if (exitCode !== 0) {
				throw commanderExit(exitCode);
			}
		});

	program.commands
		.find((command) => command.name() === "warp")
		?.action(
			async (
				branch: string | undefined,
				commandOptions: {
					json?: boolean;
					new?: string | boolean;
					print?: boolean;
				},
			) => {
				const newFlag = commandOptions.new;
				const newWorktree = newFlag !== undefined && newFlag !== false;
				const newBranch = typeof newFlag === "string" ? newFlag : undefined;
				const exitCode = await runWarpCommand({
					branch: newWorktree ? (newBranch ?? branch) : branch,
					cwd: options.cwd,
					json: commandOptions.json,
					newWorktree,
					stderr: options.stderr,
					stdout: options.stdout,
				});

				if (exitCode !== 0) {
					throw commanderExit(exitCode);
				}
			},
		);

	const configCommand = program.commands.find(
		(command) => command.name() === "config",
	);

	configCommand?.action(async () => {
		const exitCode = await runConfigCommand({
			cwd: options.cwd,
			stdout: options.stdout,
		});

		if (exitCode !== 0) {
			throw commanderExit(exitCode);
		}
	});

	configCommand?.commands
		.find((command) => command.name() === "get")
		?.action(async (key?: string) => {
			const exitCode = await runConfigCommand({
				action: "get",
				cwd: options.cwd,
				key,
				stdout: options.stdout,
			});

			if (exitCode !== 0) {
				throw commanderExit(exitCode);
			}
		});

	configCommand?.commands
		.find((command) => command.name() === "set")
		?.action(async (key: string, value: string) => {
			const exitCode = await runConfigCommand({
				action: "set",
				cwd: options.cwd,
				key,
				stdout: options.stdout,
				value,
			});

			if (exitCode !== 0) {
				throw commanderExit(exitCode);
			}
		});

	configCommand?.commands
		.find((command) => command.name() === "unset")
		?.action(async (key: string) => {
			const exitCode = await runConfigCommand({
				action: "unset",
				cwd: options.cwd,
				key,
				stdout: options.stdout,
			});

			if (exitCode !== 0) {
				throw commanderExit(exitCode);
			}
		});
}

function notImplemented(commandName: string): () => never {
	return () => {
		throw new Error(`'${commandName}' is not implemented yet.`);
	};
}

function commanderExit(
	exitCode: number,
): Error & { code: string; exitCode: number } {
	const error = new Error(`Command exited with code ${exitCode}.`) as Error & {
		code: string;
		exitCode: number;
	};

	error.code = "commander.executeSubCommandAsync";
	error.exitCode = exitCode;

	return error;
}

function isCommanderExit(
	error: unknown,
): error is Error & { code: string; exitCode: number } {
	return (
		error instanceof Error &&
		"code" in error &&
		"exitCode" in error &&
		typeof error.code === "string" &&
		typeof error.exitCode === "number"
	);
}
