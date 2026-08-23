import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveWorktreePath } from "../../domain/worktree/policy.js";
import { parsePrInput } from "../../domain/worktree/pr-reference.js";
import type { CommandRunner as BootstrapCommandRunner } from "../../ports/process.js";
import { createBootstrapReporter } from "../../presentation/bootstrap/output.js";
import { formatDependencyBootstrapPreview } from "../../presentation/bootstrap/preview.js";
import {
	type PathConflictChoice,
	pathExists,
	promptForPathConflict,
} from "../../presentation/prompts/path-conflict.js";
import { writeShellOutput } from "../../presentation/shell/handoff.js";
import {
	createNavigationRepository,
	createNavigationTarget,
} from "../../presentation/terminal/navigation.js";
import {
	type CliDependencies,
	type CliRuntime,
	defaultCliDependencies,
} from "../dependencies.js";
import { isHeadless } from "../runtime/headless.js";

export type { PathConflictChoice };

const PR_OUTPUT_FILE_ENV = "GJI_PR_OUTPUT_FILE";

export interface PrCommandOptions {
	cwd: string;
	dryRun?: boolean;
	json?: boolean;
	noInstall?: boolean;
	number: string;
	outputEnv?: string;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
	runtime?: PrRuntime;
}

type PrRuntime = CliRuntime<
	"bootstrap" | "config" | "git" | "history" | "repositoryContext"
>;

export interface PrCommandDependencies {
	promptForPathConflict: (path: string) => Promise<PathConflictChoice>;
	runCommand: BootstrapCommandRunner;
}

type PullRequestForge = "bitbucket" | "github" | "gitlab" | "unknown";
type EffectiveGjiConfig = Awaited<
	ReturnType<CliDependencies["config"]["loadEffectiveConfig"]>
>;

export function createPrCommand(
	dependencies: Partial<PrCommandDependencies> = {},
): (options: PrCommandOptions) => Promise<number> {
	const prompt = dependencies.promptForPathConflict ?? promptForPathConflict;

	return async function runPrCommand(
		options: PrCommandOptions,
	): Promise<number> {
		const runtime = options.runtime ?? defaultCliDependencies;
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

		const repository = await runtime.repositoryContext.detectRepository(
			options.cwd,
		);
		let config: EffectiveGjiConfig;
		try {
			config = await runtime.config.loadEffectiveConfig(
				repository.repoRoot,
				undefined,
				options.json ? undefined : options.stderr,
			);
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
		const rawBasePath = runtime.config.resolveConfigString(
			config,
			"worktreePath",
		);
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
				await runtime.history.recordWorktreeUsage(worktreePath, branchName);
				await writeOutput(worktreePath, options.stdout, options.outputEnv);
				return 0;
			}

			options.stderr(
				`Aborted because target worktree path already exists: ${worktreePath}\n`,
			);
			return 1;
		}

		const dependencyMode = runtime.bootstrap.resolveMode(
			config.dependencyBootstrap,
			options.noInstall,
		);

		const dryRunDependencyBootstrap = options.dryRun
			? await runtime.bootstrap.preview(dependencyMode, {
					currentRoot: repository.currentRoot,
					repoRoot: repository.repoRoot,
					cargoBuildCommand: config.dependencyBuildCommand,
					worktreePath,
				})
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
				if (dryRunDependencyBootstrap?.targets.length)
					output.dependencyBootstrap = dryRunDependencyBootstrap;
				options.stdout(`${JSON.stringify(output, null, 2)}\n`);
			} else {
				options.stdout(
					`Would create worktree at ${worktreePath} (branch: ${branchName})\n${formatDependencyBootstrapPreview(dryRunDependencyBootstrap)}`,
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
				runtime,
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
			runtime,
		);
		const worktreeArgs = branchAlreadyExists
			? ["worktree", "add", worktreePath, branchName]
			: ["worktree", "add", "-b", branchName, worktreePath, remoteRef];

		await runtime.git.runGit(repository.repoRoot, worktreeArgs);

		const bootstrap = await runtime.bootstrap.bootstrapWorktree({
			branch: branchName,
			config,
			currentRoot: repository.currentRoot,
			dependencyDetectionRoot: worktreePath,
			dependencyMode,
			repoRoot: repository.repoRoot,
			reporter: createBootstrapReporter(options.stderr, !!options.json),
			runCommand: dependencies.runCommand,
			commandStdout: options.json ? () => undefined : options.stdout,
			commandStderr: options.json ? () => undefined : options.stderr,
			worktreePath,
		});
		if (!bootstrap.ready) {
			const details = {
				dependencyBootstrap: bootstrap.dependencyBootstrap,
				path: worktreePath,
				syncFiles: bootstrap.syncFileFailures,
			};
			if (options.json) {
				options.stderr(
					`${JSON.stringify({ error: "worktree bootstrap failed", ...details }, null, 2)}\n`,
				);
			} else {
				options.stderr(
					`gji pr: worktree bootstrap failed at ${worktreePath}\n`,
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
			if (bootstrap.dependencyBootstrap.events.length > 0)
				output.dependencyBootstrap = bootstrap.dependencyBootstrap;
			options.stdout(`${JSON.stringify(output, null, 2)}\n`);
		} else {
			await runtime.history.recordWorktreeUsage(worktreePath, branchName);
			await writeOutput(worktreePath, options.stdout, options.outputEnv);
		}

		return 0;
	};
}

async function localBranchExists(
	repoRoot: string,
	branchName: string,
	runtime: PrRuntime,
): Promise<boolean> {
	try {
		await runtime.git.runGit(repoRoot, [
			"show-ref",
			"--verify",
			"--quiet",
			`refs/heads/${branchName}`,
		]);
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
	runtime: PrRuntime,
): Promise<void> {
	for (const sourceRef of listPullRequestSourceRefs(input, prNumber)) {
		try {
			await runtime.git.runGit(repoRoot, [
				"fetch",
				"origin",
				`${sourceRef}:${remoteRef}`,
			]);
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
