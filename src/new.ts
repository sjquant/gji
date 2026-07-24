import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { isCancel, text } from "@clack/prompts";
import { createBootstrapReporter } from "./bootstrap-output.js";
import {
	createDependencyBootstrapPreview,
	formatDependencyBootstrapPreview,
} from "./bootstrap-preview.js";
import {
	type EffectiveGjiConfig,
	loadEffectiveConfigResult,
	resolveConfigString,
} from "./config.js";
import {
	type PathConflictChoice,
	pathExists,
	promptForPathConflict,
} from "./conflict.js";
import {
	type DependencyBootstrapPromptDependencies,
	resolveDependencyBootstrapPolicy,
} from "./dependency-bootstrap-prompt.js";
import { type CloneDirectory, cloneDir } from "./dir-clone.js";
import { defaultSpawnEditor, EDITORS } from "./editor.js";
import { formatBytes } from "./format-bytes.js";
import { isHeadless } from "./headless.js";
import { recordWorktreeUsage } from "./history.js";
import type { InstallPromptDependencies } from "./install-prompt.js";
import {
	createNavigationRepository,
	createNavigationTarget,
} from "./navigation-output.js";
import {
	detectRepository,
	resolveWorktreePath,
	validateBranchName,
} from "./repo.js";
import { writeShellOutput } from "./shell-handoff.js";
import { estimateSyncDirectories } from "./sync-plan.js";
import { bootstrapWorktree } from "./worktree-bootstrap.js";

const execFileAsync = promisify(execFile);

export type { PathConflictChoice };

const NEW_OUTPUT_FILE_ENV = "GJI_NEW_OUTPUT_FILE";

export type NewWorktreeMode = "create" | "checkout" | "track";

export interface NewCommandOptions {
	branch?: string;
	copy?: boolean;
	cwd: string;
	detached?: boolean;
	dryRun?: boolean;
	editor?: string;
	fromCurrent?: boolean;
	force?: boolean;
	json?: boolean;
	mode?: NewWorktreeMode;
	open?: boolean;
	outputEnv?: string;
	remote?: string;
	take?: boolean;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export interface NewCommandDependencies
	extends InstallPromptDependencies,
		DependencyBootstrapPromptDependencies {
	cloneDir: CloneDirectory;
	createBranchPlaceholder: () => string;
	promptForBranch: (placeholder: string) => Promise<string | null>;
	promptForPathConflict: (path: string) => Promise<PathConflictChoice>;
	spawnEditor: (cli: string, args: string[]) => Promise<void>;
}

export function createNewCommand(
	dependencies: Partial<NewCommandDependencies> = {},
): (options: NewCommandOptions) => Promise<number> {
	const createBranchPlaceholder =
		dependencies.createBranchPlaceholder ?? generateBranchPlaceholder;
	const cloneDirectory = dependencies.cloneDir ?? cloneDir;
	const promptForBranch =
		dependencies.promptForBranch ?? defaultPromptForBranch;
	const prompt = dependencies.promptForPathConflict ?? promptForPathConflict;
	const spawnEditor = dependencies.spawnEditor ?? defaultSpawnEditor;

	return async function runNewCommand(
		options: NewCommandOptions,
	): Promise<number> {
		if (options.copy && !options.take)
			return emitNewError(options, "--copy requires --take");
		if (options.detached && options.fromCurrent) {
			const message = "--from-current cannot be used with --detached";
			if (options.json) {
				options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
			} else {
				options.stderr(`gji new: ${message}\n`);
			}
			return 1;
		}

		const repository = await detectRepository(options.cwd);
		let config: EffectiveGjiConfig;
		let dependencyBootstrapExplicit: boolean;
		try {
			const loaded = await loadEffectiveConfigResult(
				repository.repoRoot,
				undefined,
				options.json ? undefined : options.stderr,
			);
			config = loaded.config;
			dependencyBootstrapExplicit = loaded.dependencyBootstrapExplicit;
		} catch (error) {
			return emitNewError(
				options,
				error instanceof Error ? error.message : String(error),
			);
		}
		const usesGeneratedDetachedName =
			options.detached && options.branch === undefined;

		if (options.editor && !options.open) {
			options.stderr("gji new: --editor has no effect without --open\n");
		}

		if (
			!options.detached &&
			!options.branch &&
			(options.json || isHeadless())
		) {
			const message = "branch argument is required";
			if (options.json) {
				options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
			} else {
				options.stderr(
					`gji new: ${message} in non-interactive mode (GJI_NO_TUI=1)\n`,
				);
			}
			return 1;
		}

		const rawBranch = options.detached
			? (options.branch ?? createBranchPlaceholder())
			: (options.branch ?? (await promptForBranch(createBranchPlaceholder())));

		if (!rawBranch) {
			if (options.json) {
				options.stderr(`${JSON.stringify({ error: "Aborted" }, null, 2)}\n`);
			} else {
				options.stderr("Aborted\n");
			}
			return 1;
		}

		if (!options.detached) {
			const branchError = validateBranchName(rawBranch);
			if (branchError) {
				if (options.json) {
					options.stderr(
						`${JSON.stringify({ error: branchError }, null, 2)}\n`,
					);
				} else {
					options.stderr(`gji new: ${branchError}\n`);
				}
				return 1;
			}
		}

		const rawBasePath = resolveConfigString(config, "worktreePath");
		const configuredBasePath =
			rawBasePath?.startsWith("/") || rawBasePath?.startsWith("~")
				? rawBasePath
				: undefined;
		const worktreeName = options.mode
			? rawBranch
			: options.detached
				? rawBranch
				: applyConfiguredBranchPrefix(rawBranch, config.branchPrefix);
		const worktreePath = usesGeneratedDetachedName
			? await resolveUniqueDetachedWorktreePath(
					repository.repoRoot,
					worktreeName,
					configuredBasePath,
				)
			: resolveWorktreePath(
					repository.repoRoot,
					worktreeName,
					configuredBasePath,
				);

		if (!usesGeneratedDetachedName && (await pathExists(worktreePath))) {
			if (options.force) {
				if (!options.dryRun) {
					try {
						await execFileAsync(
							"git",
							["worktree", "remove", "--force", worktreePath],
							{ cwd: repository.repoRoot },
						);
					} catch (err) {
						if (!isNotRegisteredWorktreeError(err)) {
							const msg = `could not remove existing worktree at ${worktreePath}: ${toExecMessage(err)}`;
							if (options.json) {
								options.stderr(
									`${JSON.stringify({ warning: msg }, null, 2)}\n`,
								);
							} else {
								options.stderr(`Warning: ${msg}\n`);
							}
						}
					}
					if (!options.detached) {
						try {
							await execFileAsync("git", ["branch", "-D", worktreeName], {
								cwd: repository.repoRoot,
							});
						} catch {
							// Branch may not exist; proceed anyway.
						}
					}
				}
			} else if (options.json || isHeadless()) {
				const message = `target worktree path already exists: ${worktreePath}`;
				if (options.json) {
					options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
				} else {
					options.stderr(
						`gji new: ${message} in non-interactive mode (GJI_NO_TUI=1)\n`,
					);
					options.stderr(
						`Hint: Use 'gji done ${worktreeName}' or 'gji clean' to remove the existing worktree\n`,
					);
					options.stderr(
						`Hint: Use 'gji run-hook after-create' inside the worktree to re-run setup hooks\n`,
					);
				}
				return 1;
			} else {
				const choice = await prompt(worktreePath);

				if (choice === "reuse") {
					await recordWorktreeUsage(worktreePath, worktreeName);
					await writeOutput(worktreePath, options.stdout, options.outputEnv);
					return 0;
				}

				options.stderr(
					`Aborted because target worktree path already exists: ${worktreePath}\n`,
				);
				return 1;
			}
		}

		const dependencyPolicy = await resolveDependencyBootstrapPolicy(
			{
				currentRoot: repository.currentRoot,
				repoRoot: repository.repoRoot,
				worktreePath,
			},
			config,
			dependencyBootstrapExplicit,
			{
				dependencies,
				dryRun: options.dryRun,
				legacyInstallPromptConfigured:
					dependencies.promptForInstallChoice !== undefined,
				nonInteractive: !!options.json,
				stderr: options.stderr,
			},
		);
		config = {
			...config,
			dependencyBootstrap: dependencyPolicy.mode,
		};
		const dependencyBootstrapPolicyResolved =
			dependencyBootstrapExplicit || dependencyPolicy.prompted;

		if (options.dryRun) {
			if (options.take) {
				const changedFiles = await listTakeFiles(options.cwd);
				const submoduleFiles = await listSubmoduleFiles(
					options.cwd,
					changedFiles,
				);
				const transferableFiles = changedFiles.filter(
					(file) => !submoduleFiles.includes(file),
				);
				const ignoredFiles = await listIgnoredFiles(options.cwd);
				if (transferableFiles.length === 0)
					return emitNewError(
						options,
						submoduleFiles.length > 0
							? "nothing to take: submodule changes are not supported"
							: ignoredFiles.length > 0
								? "nothing to take: ignored files are not moved"
								: "nothing to take: working tree is clean",
					);
				if (options.json)
					options.stdout(
						`${JSON.stringify({ branch: worktreeName, path: worktreePath, dryRun: true, take: transferableFiles, ignored: ignoredFiles, submodules: submoduleFiles }, null, 2)}\n`,
					);
				else {
					options.stdout(
						`Would take ${transferableFiles.length} changed file${transferableFiles.length === 1 ? "" : "s"} into ${worktreeName}${ignoredFiles.length > 0 ? ` (ignored files not moved: ${ignoredFiles.length})` : ""}${submoduleFiles.length > 0 ? ` (submodules not moved: ${submoduleFiles.length})` : ""}\n${transferableFiles.map((file) => `  ${file}\n`).join("")}`,
					);
				}
				return 0;
			}
			const dryRunSyncDirs = await estimateSyncDirectories(
				repository.repoRoot,
				worktreePath,
				config.syncDirs ?? [],
			);
			const dryRunDependencyBootstrap = await createDependencyBootstrapPreview(
				config.dependencyBootstrap ?? "off",
				{
					currentRoot: repository.currentRoot,
					repoRoot: repository.repoRoot,
					cargoBuildCommand: config.dependencyBuildCommand,
					worktreePath,
				},
			);
			if (options.json) {
				const output: Record<string, unknown> = {
					...createNavigationTarget(
						createNavigationRepository(
							repository.repoName,
							repository.repoRoot,
						),
						worktreePath,
						worktreeName,
					),
					dryRun: true,
				};
				if (dryRunSyncDirs.length > 0) output.syncDirs = dryRunSyncDirs;
				if (dryRunDependencyBootstrap.targets.length > 0)
					output.dependencyBootstrap = dryRunDependencyBootstrap;
				options.stdout(`${JSON.stringify(output, null, 2)}\n`);
			} else {
				const resolvedEditor = options.open
					? (options.editor ?? resolveConfigString(config, "editor"))
					: undefined;
				const openNote = resolvedEditor
					? `, then open in ${resolvedEditor}`
					: "";
				options.stdout(
					`Would create worktree at ${worktreePath} (branch: ${worktreeName}${openNote})\n${dryRunSyncDirs.map(({ dir, bytes }) => `Would clone ${dir} (${formatBytes(bytes)})\n`).join("")}${formatDependencyBootstrapPreview(dryRunDependencyBootstrap)}`,
				);
			}
			return 0;
		}

		await mkdir(dirname(worktreePath), { recursive: true });
		const startPoint =
			options.fromCurrent && !options.detached
				? await resolveCurrentWorktreeHead(options.cwd)
				: undefined;
		const takeStartPoint = options.take
			? await resolveCurrentWorktreeHead(options.cwd)
			: undefined;
		const changedTakeFiles = options.take
			? await listTakeFiles(options.cwd)
			: [];
		const submoduleFiles = options.take
			? await listSubmoduleFiles(options.cwd, changedTakeFiles)
			: [];
		const takeFiles = changedTakeFiles.filter(
			(file) => !submoduleFiles.includes(file),
		);
		const takeUntracked = options.take
			? await countUntrackedFiles(options.cwd)
			: 0;
		if (options.take && takeFiles.length === 0)
			return emitNewError(
				options,
				submoduleFiles.length > 0
					? "nothing to take: submodule changes are not supported"
					: "nothing to take: working tree is clean",
			);
		if (options.take && submoduleFiles.length > 0)
			options.stderr(
				`Warning: submodule changes are not transferred: ${submoduleFiles.join(", ")}\n`,
			);
		let stashSha: string | null = null;
		if (options.take) {
			try {
				const inProgressState = await detectInProgressGitState(options.cwd);
				if (inProgressState)
					return emitNewError(
						options,
						`cannot take changes while Git is in progress (${inProgressState})`,
					);
				stashSha = await createTakeStash(options.cwd, worktreeName);
			} catch (error) {
				return emitNewError(
					options,
					`could not stash changes safely: ${toExecMessage(error)}`,
				);
			}
		}
		const gitArgs = options.detached
			? [
					"worktree",
					"add",
					"--detach",
					worktreePath,
					...(takeStartPoint ? [takeStartPoint] : []),
				]
			: options.mode === "track"
				? [
						"worktree",
						"add",
						"--track",
						"-b",
						worktreeName,
						worktreePath,
						`${options.remote ?? "origin"}/${worktreeName}`,
					]
				: options.mode === "checkout" ||
						(await localBranchExists(repository.repoRoot, worktreeName))
					? ["worktree", "add", worktreePath, worktreeName]
					: [
							"worktree",
							"add",
							"-b",
							worktreeName,
							worktreePath,
							...(takeStartPoint
								? [takeStartPoint]
								: startPoint
									? [startPoint]
									: []),
						];
		try {
			await execFileAsync("git", gitArgs, { cwd: repository.repoRoot });
		} catch (error) {
			if (stashSha)
				await restoreTakeStash(options.cwd, stashSha, options.stderr);
			return emitNewError(
				options,
				`failed to create worktree: ${toExecMessage(error)}`,
			);
		}
		if (
			stashSha &&
			!(await applyTakeStash(
				worktreePath,
				options.cwd,
				stashSha,
				!!options.copy,
				options.stderr,
			))
		) {
			try {
				await execFileAsync(
					"git",
					["worktree", "remove", "--force", worktreePath],
					{ cwd: repository.repoRoot },
				);
			} catch {
				/* rollback best effort */
			}
			return emitNewError(
				options,
				`could not apply taken changes; your changes are safe in stash: ${stashSha}`,
			);
		}

		const bootstrap = await bootstrapWorktree({
			branch: worktreeName,
			cloneDirectory,
			config,
			currentRoot: repository.currentRoot,
			nonInteractive: !!options.json,
			repoRoot: repository.repoRoot,
			reporter: createBootstrapReporter(options.stderr, !!options.json),
			runCommand: dependencies.runInstallCommand,
			commandStdout: options.json ? () => undefined : options.stdout,
			commandStderr: options.json ? () => undefined : options.stderr,
			json: options.json,
			worktreePath,
			installDependencies: dependencies,
			dependencyBootstrapPolicyResolved,
		});
		if (!bootstrap.ready) {
			return emitNewError(options, "dependency bootstrap failed", {
				dependencyBootstrap: bootstrap.dependencyBootstrap,
				path: worktreePath,
				skipped: bootstrap.skippedDirs,
			});
		}

		if (options.json) {
			const navigation = createNavigationTarget(
				createNavigationRepository(repository.repoName, repository.repoRoot),
				worktreePath,
				worktreeName,
			);
			const output: Record<string, unknown> = options.take
				? {
						...navigation,
						taken: {
							files: takeFiles.length,
							untracked: takeUntracked,
							submodules: submoduleFiles,
						},
					}
				: { ...navigation };
			if (bootstrap.clonedDirs.length > 0) {
				output.cloned = bootstrap.clonedDirs.map(({ dir, ms }) => ({
					dir,
					ms,
				}));
			}
			if (bootstrap.skippedDirs.length > 0)
				output.skipped = bootstrap.skippedDirs;
			if (bootstrap.dependencyBootstrap.mode !== "off")
				output.dependencyBootstrap = bootstrap.dependencyBootstrap;
			options.stdout(`${JSON.stringify(output, null, 2)}\n`);
		} else {
			if (options.take)
				options.stderr(
					`✓ took ${takeFiles.length} changed file${takeFiles.length === 1 ? "" : "s"} (${takeUntracked} untracked) → ${worktreeName}\n`,
				);
			await recordWorktreeUsage(worktreePath, worktreeName);
			await writeOutput(worktreePath, options.stdout, options.outputEnv);
		}

		if (options.open) {
			const resolvedEditor =
				options.editor ?? resolveConfigString(config, "editor");
			await openWorktree(
				worktreePath,
				resolvedEditor,
				spawnEditor,
				options.stderr,
			);
		}

		return 0;
	};
}

export const runNewCommand = createNewCommand();

export function generateBranchPlaceholder(
	random: () => number = Math.random,
): string {
	const roots = [
		"socrates",
		"prometheus",
		"beethoven",
		"ada",
		"turing",
		"hypatia",
		"tesla",
		"curie",
		"diogenes",
		"plato",
		"hephaestus",
		"athena",
		"archimedes",
		"euclid",
		"heraclitus",
		"galileo",
		"newton",
		"lovelace",
		"nietzsche",
		"kafka",
		"sappho",
		"aristotle",
		"pythagoras",
		"artemis",
		"apollo",
		"minerva",
		"persephone",
		"icarus",
		"odysseus",
		"murasaki",
		"shakespeare",
		"frida",
		"davinci",
		"kepler",
		"copernicus",
		"faraday",
		"noether",
		"hopper",
		"boole",
		"shannon",
		"gauss",
		"ramanujan",
		"austen",
		"borges",
		"zeno",
	];
	const antics = [
		"borrowed-a-bike",
		"brought-snacks",
		"missed-the-bus",
		"lost-the-keys",
		"spilled-the-coffee",
		"forgot-the-umbrella",
		"walked-the-dog",
		"missed-the-train",
		"wrote-a-poem",
		"burned-the-toast",
		"fed-the-pigeons",
		"watered-the-plants",
		"washed-the-dishes",
		"folded-the-laundry",
		"took-a-nap",
		"lost-a-sock",
		"patched-the-boat",
		"alphabetized-the-spoons",
		"argued-with-the-calendar",
		"misplaced-the-moon",
		"painted-the-fence",
		"overcooked-the-rice",
		"packed-the-snacks",
		"dropped-the-spoon",
		"hid-the-remote",
		"untangled-the-cables",
		"rebooted-the-kettle",
		"indexed-the-attic",
		"forgot-the-password",
		"sorted-the-buttons",
		"mopped-the-ceiling",
		"polished-the-doorknob",
		"misread-the-map",
		"reheated-the-tea",
		"fixed-the-squeak",
		"labeled-the-drawer",
		"stacked-the-chairs",
		"overslept-the-standup",
		"claimed-the-last-bagel",
		"debugged-the-toaster",
	];

	const root = pickRandom(roots, random);
	const antic = pickRandom(antics, random);
	const suffix = generateBranchPlaceholderSuffix(random);

	return `${root}-${antic}-${suffix}`;
}

function pickRandom(values: string[], random: () => number): string {
	const index = Math.floor(random() * values.length);

	return values[Math.min(index, values.length - 1)];
}

function generateBranchPlaceholderSuffix(random: () => number): string {
	const characters = "abcdefghijklmnopqrstuvwxyz0123456789";
	let suffix = "";

	for (let index = 0; index < 3; index += 1) {
		const characterIndex = Math.floor(random() * characters.length);
		suffix += characters[Math.min(characterIndex, characters.length - 1)];
	}

	return suffix;
}

function applyConfiguredBranchPrefix(
	branch: string,
	branchPrefix: unknown,
): string {
	if (typeof branchPrefix !== "string" || branchPrefix.length === 0) {
		return branch;
	}

	if (branch.startsWith(branchPrefix)) {
		return branch;
	}

	return `${branchPrefix}${branch}`;
}

async function resolveUniqueDetachedWorktreePath(
	repoRoot: string,
	baseName: string,
	basePath?: string,
): Promise<string> {
	let attempt = 1;

	while (true) {
		const candidateName = attempt === 1 ? baseName : `${baseName}-${attempt}`;
		const candidatePath = resolveWorktreePath(
			repoRoot,
			candidateName,
			basePath,
		);

		if (!(await pathExists(candidatePath))) {
			return candidatePath;
		}

		attempt += 1;
	}
}

async function defaultPromptForBranch(
	placeholder: string,
): Promise<string | null> {
	const choice = await text({
		defaultValue: placeholder,
		message: "Name the new branch",
		placeholder,
		validate: (value) => {
			const trimmed = value.trim();
			return validateBranchName(trimmed) ?? undefined;
		},
	});

	if (isCancel(choice)) {
		return null;
	}

	return choice.trim();
}

async function localBranchExists(
	repoRoot: string,
	branchName: string,
): Promise<boolean> {
	try {
		await execFileAsync(
			"git",
			["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
			{ cwd: repoRoot },
		);
		return true;
	} catch {
		return false;
	}
}

async function resolveCurrentWorktreeHead(cwd: string): Promise<string> {
	return execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd }).then(
		({ stdout }) => stdout.trim(),
	);
}

async function createTakeStash(
	cwd: string,
	worktreeName: string,
): Promise<string> {
	const message = `gji-take: ${worktreeName}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	await execFileAsync(
		"git",
		["stash", "push", "--include-untracked", "-m", message],
		{ cwd },
	);
	const { stdout } = await execFileAsync(
		"git",
		["stash", "list", "--format=%H%x00%s"],
		{ cwd },
	);
	const line = stdout
		.split("\n")
		.map((candidate) => candidate.split("\0"))
		.find(([, subject]) => subject?.endsWith(message));
	if (!line?.[0])
		throw new Error("could not identify the stash created for --take");
	return line[0];
}

async function detectInProgressGitState(cwd: string): Promise<string | null> {
	const markers = [
		["MERGE_HEAD", "merge"],
		["rebase-merge", "rebase"],
		["rebase-apply", "rebase"],
		["CHERRY_PICK_HEAD", "cherry-pick"],
		["REVERT_HEAD", "revert"],
		["BISECT_LOG", "bisect"],
	] as const;
	for (const [marker, name] of markers) {
		try {
			const { stdout } = await execFileAsync(
				"git",
				["rev-parse", "--git-path", marker],
				{ cwd },
			);
			await access(resolve(cwd, stdout.trim()));
			return name;
		} catch {
			/* marker is absent */
		}
	}
	return null;
}

async function writeOutput(
	worktreePath: string,
	stdout: (chunk: string) => void,
	outputEnv: string | undefined,
): Promise<void> {
	await writeShellOutput(
		outputEnv ?? NEW_OUTPUT_FILE_ENV,
		worktreePath,
		stdout,
	);
}

function isNotRegisteredWorktreeError(error: unknown): boolean {
	const stderr = hasExecStderr(error) ? error.stderr : String(error);
	return (
		stderr.includes("is not a working tree") ||
		stderr.includes("not a linked working tree")
	);
}

function hasExecStderr(error: unknown): error is { stderr: string } {
	return (
		error instanceof Error &&
		"stderr" in error &&
		typeof (error as { stderr: unknown }).stderr === "string"
	);
}

function toExecMessage(error: unknown): string {
	return hasExecStderr(error) ? error.stderr.trim() : String(error);
}

async function openWorktree(
	worktreePath: string,
	editorCli: string | undefined,
	spawnFn: (cli: string, args: string[]) => Promise<void>,
	stderr: (chunk: string) => void,
): Promise<void> {
	if (!editorCli) {
		stderr(
			"gji new: --open requires --editor <cli> or a saved editor in config\n",
		);
		return;
	}

	const editorDef = EDITORS.find((e) => e.cli === editorCli);
	const args: string[] = [];
	if (editorDef?.newWindowFlag) {
		args.push(editorDef.newWindowFlag);
	}
	args.push(worktreePath);

	try {
		await spawnFn(editorCli, args);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stderr(`gji new: failed to open editor: ${message}\n`);
	}
}

async function listTakeFiles(cwd: string): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["status", "--porcelain=v1"],
			{ cwd },
		);
		return stdout
			.split("\n")
			.filter((line) => line.length > 3)
			.map((line) => line.slice(3).replace(/^"|"$/g, ""));
	} catch {
		return [];
	}
}

async function listIgnoredFiles(cwd: string): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["status", "--porcelain=v1", "--ignored", "--untracked-files=all"],
			{ cwd },
		);
		return stdout
			.split("\n")
			.filter((line) => line.startsWith("!! "))
			.map((line) => line.slice(3).replace(/^"|"$/g, ""));
	} catch {
		return [];
	}
}

async function listSubmoduleFiles(
	cwd: string,
	changedFiles: string[],
): Promise<string[]> {
	if (changedFiles.length === 0) return [];
	try {
		const { stdout } = await execFileAsync("git", ["ls-files", "--stage"], {
			cwd,
		});
		const submodules = new Set(
			stdout
				.split("\n")
				.filter((line) => line.startsWith("160000 "))
				.map((line) => line.slice(line.indexOf("\t") + 1)),
		);
		return changedFiles.filter((file) => submodules.has(file));
	} catch {
		return [];
	}
}
async function countUntrackedFiles(cwd: string): Promise<number> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["status", "--porcelain=v1", "--untracked-files=all"],
			{ cwd },
		);
		return stdout.split("\n").filter((line) => line.startsWith("?? ")).length;
	} catch {
		return 0;
	}
}
async function applyTakeStash(
	worktreePath: string,
	sourcePath: string,
	stashSha: string,
	copy: boolean,
	stderr: (chunk: string) => void,
): Promise<boolean> {
	try {
		await execFileAsync("git", ["stash", "apply", stashSha], {
			cwd: worktreePath,
		});
	} catch (error) {
		stderr(`Warning: stash apply failed: ${toExecMessage(error)}\n`);
		await restoreTakeStash(sourcePath, stashSha, stderr);
		return false;
	}
	if (copy) {
		try {
			await execFileAsync("git", ["stash", "apply", stashSha], {
				cwd: sourcePath,
			});
		} catch (error) {
			stderr(
				`Warning: could not restore copied changes to the source: ${toExecMessage(error)}\n`,
			);
			return false;
		}
	}
	try {
		const { stdout } = await execFileAsync(
			"git",
			["stash", "list", "--format=%H %gd"],
			{ cwd: sourcePath },
		);
		const line = stdout
			.split("\n")
			.find((candidate) => candidate.startsWith(stashSha));
		const ref = line?.trim().split(/\s+/).at(1);
		if (ref)
			await execFileAsync("git", ["stash", "drop", ref], { cwd: sourcePath });
	} catch {
		/* preserving the stash is safer */
	}
	return true;
}
async function restoreTakeStash(
	sourcePath: string,
	stashSha: string,
	stderr: (chunk: string) => void,
): Promise<void> {
	try {
		await execFileAsync("git", ["stash", "apply", stashSha], {
			cwd: sourcePath,
		});
	} catch {
		stderr(
			`Your changes are safe in stash: ${stashSha} — run "git stash apply ${stashSha}" to restore\n`,
		);
	}
}
function emitNewError(
	options: NewCommandOptions,
	message: string,
	details?: Record<string, unknown>,
): number {
	if (options.json)
		options.stderr(
			`${JSON.stringify({ error: message, ...details }, null, 2)}\n`,
		);
	else {
		const path = typeof details?.path === "string" ? details.path : undefined;
		options.stderr(`gji new: ${message}${path ? ` at ${path}` : ""}\n`);
		if (path) {
			options.stderr(
				`Hint: inspect the worktree or remove it with 'gji done ${path}' before retrying\n`,
			);
		}
	}
	return 1;
}
