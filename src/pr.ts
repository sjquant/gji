import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";

import { loadEffectiveConfig, resolveConfigString } from "./config.js";
import {
	type PathConflictChoice,
	pathExists,
	promptForPathConflict,
} from "./conflict.js";
import { syncFiles } from "./file-sync.js";
import { isHeadless } from "./headless.js";
import { appendHistory } from "./history.js";
import { extractHooks, runHook } from "./hooks.js";
import {
	type InstallPromptDependencies,
	maybeRunInstallPrompt,
} from "./install-prompt.js";
import { detectRepository, resolveWorktreePath } from "./repo.js";
import { writeShellOutput } from "./shell-handoff.js";

const execFileAsync = promisify(execFile);

export type { PathConflictChoice };

const PR_OUTPUT_FILE_ENV = "GJI_PR_OUTPUT_FILE";

export interface PrCommandOptions {
	cwd: string;
	dryRun?: boolean;
	json?: boolean;
	number: string;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export interface PrCommandDependencies extends InstallPromptDependencies {
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
		const config = await loadEffectiveConfig(
			repository.repoRoot,
			undefined,
			options.stderr,
		);
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
						`Hint: Use 'gji remove pr/${prNumber}' or 'gji clean' to remove the existing worktree\n`,
					);
				}
				return 1;
			}

			const choice = await prompt(worktreePath);

			if (choice === "reuse") {
				appendHistory(worktreePath, branchName).catch(() => undefined);
				await writeOutput(worktreePath, options.stdout);
				return 0;
			}

			options.stderr(
				`Aborted because target worktree path already exists: ${worktreePath}\n`,
			);
			return 1;
		}

		if (options.dryRun) {
			if (options.json) {
				options.stdout(
					`${JSON.stringify({ branch: branchName, path: worktreePath, dryRun: true }, null, 2)}\n`,
				);
			} else {
				options.stdout(
					`Would create worktree at ${worktreePath} (branch: ${branchName})\n`,
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

		// Sync files from main worktree before afterCreate so synced files are available to install scripts.
		const syncPatterns = Array.isArray(config.syncFiles)
			? (config.syncFiles as unknown[]).filter(
					(p): p is string => typeof p === "string",
				)
			: [];
		for (const pattern of syncPatterns) {
			try {
				await syncFiles(repository.repoRoot, worktreePath, [pattern]);
			} catch (error) {
				options.stderr(
					`Warning: failed to sync file "${pattern}": ${error instanceof Error ? error.message : String(error)}\n`,
				);
			}
		}

		await maybeRunInstallPrompt(
			worktreePath,
			repository.repoRoot,
			config,
			options.stderr,
			dependencies,
			!!options.json,
		);

		const hooks = extractHooks(config);
		await runHook(
			hooks.afterCreate,
			worktreePath,
			{
				branch: branchName,
				path: worktreePath,
				repo: basename(repository.repoRoot),
			},
			options.stderr,
		);

		if (options.json) {
			options.stdout(
				`${JSON.stringify({ branch: branchName, path: worktreePath }, null, 2)}\n`,
			);
		} else {
			await appendHistory(worktreePath, branchName);
			await writeOutput(worktreePath, options.stdout);
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
): Promise<void> {
	await writeShellOutput(PR_OUTPUT_FILE_ENV, worktreePath, stdout);
}
