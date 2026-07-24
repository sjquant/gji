import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
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
import type { CloneDirectory } from "./dir-clone.js";
import { isHeadless } from "./headless.js";
import { recordWorktreeUsage } from "./history.js";
import type { InstallPromptDependencies } from "./install-prompt.js";
import {
	createNavigationRepository,
	createNavigationTarget,
} from "./navigation-output.js";
import { detectRepository, resolveWorktreePath } from "./repo.js";
import { writeShellOutput } from "./shell-handoff.js";
import { estimateSyncDirectories } from "./sync-plan.js";
import { bootstrapWorktree } from "./worktree-bootstrap.js";

const execFileAsync = promisify(execFile);

export type { PathConflictChoice };

const PR_OUTPUT_FILE_ENV = "GJI_PR_OUTPUT_FILE";

export interface PrCommandOptions {
	cwd: string;
	dryRun?: boolean;
	json?: boolean;
	number: string;
	outputEnv?: string;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export interface PrCommandDependencies
	extends InstallPromptDependencies,
		DependencyBootstrapPromptDependencies {
	cloneDir?: CloneDirectory;
	promptForPathConflict: (path: string) => Promise<PathConflictChoice>;
}

type PullRequestForge = "bitbucket" | "github" | "gitlab" | "unknown";

export function parsePrInput(input: string): string | null {
	if (/^\d+$/.test(input)) return input;

	const hashMatch = input.match(/^#(\d+)$/);
	if (hashMatch) return hashMatch[1];

	const urlMatch = input.match(
		/\/(?:pull|pull-requests|merge_requests)\/(\d+)/,
	);
	if (urlMatch) return urlMatch[1];

	return null;
}

export function createPrCommand(
	dependencies: Partial<PrCommandDependencies> = {},
): (options: PrCommandOptions) => Promise<number> {
	const prompt = dependencies.promptForPathConflict ?? promptForPathConflict;

	return async function runPrCommand(
		options: PrCommandOptions,
	): Promise<number> {
		const prNumber = parsePrInput(options.number);

		if (!prNumber) {
			const message = `Invalid PR reference: ${options.number}`;
			if (options.json) {
				options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
			} else {
				options.stderr(`${message}\n`);
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
			const message = error instanceof Error ? error.message : String(error);
			if (options.json) {
				options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
			} else {
				options.stderr(`gji pr: ${message}\n`);
			}
			return 1;
		}
		const branchName = `pr/${prNumber}`;
		const remoteRef = `refs/remotes/origin/pull/${prNumber}/head`;
		const rawBasePath = resolveConfigString(config, "worktreePath");
		const configuredBasePath =
			rawBasePath?.startsWith("/") || rawBasePath?.startsWith("~")
				? rawBasePath
				: undefined;
		const worktreePath = resolveWorktreePath(
			repository.repoRoot,
			branchName,
			configuredBasePath,
		);

		if (await pathExists(worktreePath)) {
			if (options.json || isHeadless()) {
				const message = `target worktree path already exists: ${worktreePath}`;
				if (options.json) {
					options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
				} else {
					options.stderr(
						`gji pr: ${message} in non-interactive mode (GJI_NO_TUI=1)\n`,
					);
					options.stderr(
						`Hint: Use 'gji done pr/${prNumber}' or 'gji clean' to remove the existing worktree\n`,
					);
				}
				return 1;
			}

			const choice = await prompt(worktreePath);

			if (choice === "reuse") {
				await recordWorktreeUsage(worktreePath, branchName);
				await writeOutput(worktreePath, options.stdout, options.outputEnv);
				return 0;
			}

			options.stderr(
				`Aborted because target worktree path already exists: ${worktreePath}\n`,
			);
			return 1;
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

		const dryRunSyncDirs = options.dryRun
			? await estimateSyncDirectories(
					repository.repoRoot,
					worktreePath,
					config.syncDirs ?? [],
				)
			: [];
		const dryRunDependencyBootstrap = options.dryRun
			? await createDependencyBootstrapPreview(
					config.dependencyBootstrap ?? "off",
					{
						currentRoot: repository.currentRoot,
						repoRoot: repository.repoRoot,
						cargoBuildCommand: config.dependencyBuildCommand,
						worktreePath,
					},
				)
			: undefined;

		if (options.dryRun) {
			if (options.json) {
				const output: Record<string, unknown> = {
					...createNavigationTarget(
						createNavigationRepository(
							repository.repoName,
							repository.repoRoot,
						),
						worktreePath,
						branchName,
					),
					dryRun: true,
				};
				if (dryRunSyncDirs.length > 0) output.syncDirs = dryRunSyncDirs;
				if (dryRunDependencyBootstrap?.targets.length)
					output.dependencyBootstrap = dryRunDependencyBootstrap;
				options.stdout(`${JSON.stringify(output, null, 2)}\n`);
			} else {
				options.stdout(
					`Would create worktree at ${worktreePath} (branch: ${branchName})\n${dryRunSyncDirs.map(({ dir, bytes }) => `Would clone ${dir} (${bytes} bytes)\n`).join("")}${formatDependencyBootstrapPreview(dryRunDependencyBootstrap)}`,
				);
			}
			return 0;
		}

		try {
			await fetchPullRequestRef(
				repository.repoRoot,
				options.number,
				prNumber,
				remoteRef,
			);
		} catch {
			const message = `Failed to fetch PR #${prNumber} from origin`;
			if (options.json) {
				options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
			} else {
				options.stderr(`${message}\n`);
				options.stderr(
					`Hint: Verify the remote is reachable: git fetch origin\n`,
				);
			}
			return 1;
		}

		await mkdir(dirname(worktreePath), { recursive: true });

		const branchAlreadyExists = await localBranchExists(
			repository.repoRoot,
			branchName,
		);
		const worktreeArgs = branchAlreadyExists
			? ["worktree", "add", worktreePath, branchName]
			: ["worktree", "add", "-b", branchName, worktreePath, remoteRef];

		await execFileAsync("git", worktreeArgs, { cwd: repository.repoRoot });

		const bootstrap = await bootstrapWorktree({
			branch: branchName,
			cloneDirectory: dependencies.cloneDir,
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
			const details = {
				dependencyBootstrap: bootstrap.dependencyBootstrap,
				path: worktreePath,
				skipped: bootstrap.skippedDirs,
			};
			if (options.json) {
				options.stderr(
					`${JSON.stringify({ error: "dependency bootstrap failed", ...details }, null, 2)}\n`,
				);
			} else {
				options.stderr(
					`gji pr: dependency bootstrap failed at ${worktreePath}\n`,
				);
				options.stderr(
					`Hint: inspect the worktree or remove it with 'gji done ${worktreePath}' before retrying\n`,
				);
			}
			return 1;
		}

		if (options.json) {
			const output: Record<string, unknown> = {
				...createNavigationTarget(
					createNavigationRepository(repository.repoName, repository.repoRoot),
					worktreePath,
					branchName,
				),
			};
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
			await recordWorktreeUsage(worktreePath, branchName);
			await writeOutput(worktreePath, options.stdout, options.outputEnv);
		}

		return 0;
	};
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

export const runPrCommand = createPrCommand();

async function fetchPullRequestRef(
	repoRoot: string,
	input: string,
	prNumber: string,
	remoteRef: string,
): Promise<void> {
	for (const sourceRef of listPullRequestSourceRefs(input, prNumber)) {
		try {
			await execFileAsync(
				"git",
				["fetch", "origin", `${sourceRef}:${remoteRef}`],
				{ cwd: repoRoot },
			);
			return;
		} catch {
			// Try the next forge-specific ref namespace before failing the command.
		}
	}

	throw new Error(`No pull request ref found for #${prNumber}`);
}

function listPullRequestSourceRefs(input: string, prNumber: string): string[] {
	const allForges: Array<Exclude<PullRequestForge, "unknown">> = [
		"github",
		"gitlab",
		"bitbucket",
	];
	const preferredForge = detectPullRequestForge(input);
	const orderedForges =
		preferredForge === "unknown"
			? allForges
			: [
					preferredForge,
					...allForges.filter((forge) => forge !== preferredForge),
				];

	return orderedForges.map((forge) => sourceRefForForge(forge, prNumber));
}

function detectPullRequestForge(input: string): PullRequestForge {
	if (/\/pull-requests\/\d+/.test(input)) {
		return "bitbucket";
	}

	if (/\/merge_requests\/\d+/.test(input)) {
		return "gitlab";
	}

	if (/\/pull\/\d+/.test(input)) {
		return "github";
	}

	return "unknown";
}

function sourceRefForForge(
	forge: Exclude<PullRequestForge, "unknown">,
	prNumber: string,
): string {
	switch (forge) {
		case "bitbucket":
			return `refs/pull-requests/${prNumber}/from`;
		case "github":
			return `refs/pull/${prNumber}/head`;
		case "gitlab":
			return `refs/merge-requests/${prNumber}/head`;
	}
}

async function writeOutput(
	worktreePath: string,
	stdout: (chunk: string) => void,
	outputEnv: string | undefined,
): Promise<void> {
	await writeShellOutput(outputEnv ?? PR_OUTPUT_FILE_ENV, worktreePath, stdout);
}
