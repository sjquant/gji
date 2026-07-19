import { basename } from "node:path";

import { confirm, isCancel } from "@clack/prompts";
import { runBackCommand } from "./back.js";
import { loadEffectiveConfig, resolveConfigString } from "./config.js";
import { isHeadless } from "./headless.js";
import { recordWorktreeUsage } from "./history.js";
import { extractHooks, runHook } from "./hooks.js";
import { runNewCommand } from "./new.js";
import { parsePrInput, runPrCommand } from "./pr.js";
import {
	detectRepository,
	getRepositoryRemoteUrl,
	hasLocalBranch,
	hasRemoteBranch,
	listWorktrees,
	type RepositoryContext,
	type WorktreeEntry,
} from "./repo.js";
import { writeShellOutput } from "./shell-handoff.js";
import {
	listRegisteredWorktreeSources,
	type WarpWorktreeSource,
} from "./warp.js";
import {
	buildWorktreePromptEntries,
	promptForSingleWorktree,
	type QueryWorktreePullRequests,
	resolveExactWorktreeQueryMatches,
	resolveWorktreeQuery,
	resolveWorktreeQueryMatches,
	type WorktreePromptEntry,
	type WorktreePromptSource,
} from "./worktree-picker.js";

export interface GoCommandOptions {
	branch?: string;
	cwd: string;
	json?: boolean;
	print?: boolean;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export interface GoCommandDependencies {
	confirmBranchCreation: (branch: string) => Promise<boolean>;
	promptForWorktree: (
		worktrees: WorktreePromptEntry[],
	) => Promise<string | null>;
	queryPullRequests: QueryWorktreePullRequests;
}

const GO_OUTPUT_FILE_ENV = "GJI_GO_OUTPUT_FILE";

export function createGoCommand(
	dependencies: Partial<GoCommandDependencies> = {},
): (options: GoCommandOptions) => Promise<number> {
	const confirmBranchCreation =
		dependencies.confirmBranchCreation ?? defaultConfirmBranchCreation;
	const prompt = dependencies.promptForWorktree ?? promptForWorktree;

	return async function runGoCommand(
		options: GoCommandOptions,
	): Promise<number> {
		if (options.branch === "-") {
			return runBackCommand({
				commandName: "gji go",
				cwd: options.cwd,
				json: options.json,
				outputEnv: GO_OUTPUT_FILE_ENV,
				stderr: options.stderr,
				stdout: options.stdout,
			});
		}

		const [repository, currentWorktrees] = await readCurrentRepository(
			options.cwd,
		);
		const currentSources = repository
			? toPromptSources(
					repository.repoRoot,
					repository.repoName,
					currentWorktrees,
				)
			: [];

		if (!options.branch) {
			if (options.json || isHeadless()) {
				return emitError(
					options,
					"branch argument is required in non-interactive mode (GJI_NO_TUI=1)",
				);
			}

			let skippedRegisteredRepos = 0;
			const registeredSources = await listRegisteredWorktreeSources(
				options.cwd,
				() => {
					skippedRegisteredRepos++;
				},
			);
			const allSources = deduplicateSources([
				...currentSources,
				...registeredSources,
			]);

			if (allSources.length === 0 && !repository) {
				return emitNoRepositoryError(options, skippedRegisteredRepos > 0);
			}

			const promptEntries = await buildWorktreePromptEntries(allSources, {
				queryPullRequests: dependencies.queryPullRequests,
			});
			const selectedPath = await prompt(promptEntries);
			if (!selectedPath) {
				options.stderr("Aborted\n");
				return 1;
			}

			const selected = allSources.find(
				(source) => source.worktree.path === selectedPath,
			);
			return navigateToExistingWorktree(
				options,
				selectedPath,
				selected?.worktree,
			);
		}

		const exactCurrentMatches = resolveExistingExactWorktreeMatches(
			currentSources,
			options.branch,
		);
		if (exactCurrentMatches.length === 1) {
			return navigateToExistingWorktree(
				options,
				exactCurrentMatches[0].worktree.path,
				exactCurrentMatches[0].worktree,
			);
		}

		let localBranch = false;
		if (repository) {
			localBranch = await hasLocalBranch(repository.repoRoot, options.branch);
		}

		const localMatch = localBranch
			? null
			: resolveWorktreeQuery(currentSources, options.branch);
		if (localMatch) {
			return navigateToExistingWorktree(
				options,
				localMatch.worktree.path,
				localMatch.worktree,
			);
		}

		let skippedRegisteredRepos = 0;
		const registeredSources = await listRegisteredWorktreeSources(
			options.cwd,
			() => {
				skippedRegisteredRepos++;
			},
		);
		const crossRepoSources = registeredSources.filter(
			(source) => source.repoRoot !== repository?.repoRoot,
		);
		const crossMatches = resolveExistingWorktreeMatches(
			crossRepoSources,
			options.branch,
		);
		if (crossMatches.length === 1) {
			return navigateToExistingWorktree(
				options,
				crossMatches[0].worktree.path,
				crossMatches[0].worktree,
			);
		}
		if (crossMatches.length > 1) {
			if (options.json || isHeadless() || options.print) {
				return emitAmbiguousCrossRepoError(options, crossMatches);
			}

			const candidates = await buildWorktreePromptEntries(crossMatches, {
				queryPullRequests: dependencies.queryPullRequests,
			});
			const selectedPath = await prompt(candidates);
			if (!selectedPath) {
				options.stderr("Aborted\n");
				return 1;
			}
			const selected = crossMatches.find(
				(source) => source.worktree.path === selectedPath,
			);
			return navigateToExistingWorktree(
				options,
				selectedPath,
				selected?.worktree,
			);
		}

		if (!repository) {
			if (parsePrInput(options.branch)) {
				return emitError(
					options,
					"PR references must be resolved from inside a git repository",
				);
			}
			if (registeredSources.length === 0) {
				return emitNoRepositoryError(options, skippedRegisteredRepos > 0);
			}
			return emitNoMatchError(options, skippedRegisteredRepos > 0);
		}

		let remote: string | undefined;
		let remoteBranch = false;
		try {
			const config = await loadEffectiveConfig(
				repository.repoRoot,
				undefined,
				options.json ? undefined : options.stderr,
			);
			remote = resolveConfigString(config, "syncRemote") ?? "origin";
			remoteBranch = await hasRemoteBranch(
				repository.repoRoot,
				remote,
				options.branch,
			);
		} catch (error) {
			return emitError(
				options,
				`could not load repository config: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		if (localBranch) {
			return createExistingBranchWorktree(
				options,
				confirmBranchCreation,
				repository,
				options.branch,
				"checkout",
			);
		}

		if (remoteBranch) {
			return createExistingBranchWorktree(
				options,
				confirmBranchCreation,
				repository,
				options.branch,
				"track",
				remote,
			);
		}

		if (parsePrInput(options.branch)) {
			if (
				!(await isPullRequestForRepository(repository.repoRoot, options.branch))
			) {
				return emitError(
					options,
					"PR URL does not belong to this repository; run gji go from the matching checkout",
				);
			}
			if (options.json || isHeadless() || options.print) {
				return emitError(
					options,
					"PR navigation creates a worktree; use `gji pr <ref>` in an interactive shell",
				);
			}

			return runPrCommand({
				cwd: repository.repoRoot,
				number: options.branch,
				outputEnv: GO_OUTPUT_FILE_ENV,
				stderr: options.stderr,
				stdout: options.stdout,
			});
		}

		return emitNoMatchError(options, skippedRegisteredRepos > 0);
	};
}

export const runGoCommand = createGoCommand();

async function readCurrentRepository(
	cwd: string,
): Promise<[RepositoryContext | null, WorktreeEntry[]]> {
	try {
		const [repository, worktrees] = await Promise.all([
			detectRepository(cwd),
			listWorktrees(cwd),
		]);
		return [repository, worktrees];
	} catch {
		return [null, []];
	}
}

function toPromptSources(
	repoRoot: string,
	repoName: string,
	worktrees: WorktreeEntry[],
): WorktreePromptSource[] {
	return worktrees.map((worktree) => ({ repoName, repoRoot, worktree }));
}

function deduplicateSources(
	sources: Array<WorktreePromptSource | WarpWorktreeSource>,
): WorktreePromptSource[] {
	const seen = new Set<string>();
	const deduplicated: WorktreePromptSource[] = [];
	for (const source of sources) {
		if (seen.has(source.worktree.path)) continue;
		seen.add(source.worktree.path);
		deduplicated.push(source);
	}
	return deduplicated;
}

function resolveExistingExactWorktreeMatches(
	sources: WorktreePromptSource[],
	query: string,
): WorktreePromptSource[] {
	const exactMatches = resolveExactWorktreeQueryMatches(sources, query);
	if (exactMatches.length > 0) return exactMatches;

	const pullRequestNumber = parsePrInput(query);
	return pullRequestNumber === null
		? []
		: resolveExactWorktreeQueryMatches(sources, `pr/${pullRequestNumber}`);
}

function resolveExistingWorktreeMatches(
	sources: WorktreePromptSource[],
	query: string,
): WorktreePromptSource[] {
	const matches = resolveWorktreeQueryMatches(sources, query);
	if (matches.length > 0) return matches;

	const pullRequestNumber = parsePrInput(query);
	return pullRequestNumber === null
		? []
		: resolveWorktreeQueryMatches(sources, `pr/${pullRequestNumber}`);
}

async function createExistingBranchWorktree(
	options: GoCommandOptions,
	confirmBranchCreation: (branch: string) => Promise<boolean>,
	repository: RepositoryContext,
	branch: string,
	mode: "checkout" | "track",
	remote?: string,
): Promise<number> {
	if (options.json || isHeadless() || options.print) {
		return emitError(
			options,
			`branch "${branch}" exists but has no worktree; use interactive gji go ${branch} to create one`,
		);
	}

	if (!(await confirmBranchCreation(branch))) {
		options.stderr("Aborted\n");
		return 1;
	}

	return runNewCommand({
		branch,
		cwd: repository.repoRoot,
		mode,
		outputEnv: GO_OUTPUT_FILE_ENV,
		remote,
		stderr: options.stderr,
		stdout: options.stdout,
	});
}

async function navigateToExistingWorktree(
	options: GoCommandOptions,
	path: string,
	worktree: WorktreeEntry | undefined,
): Promise<number> {
	if (options.json) {
		options.stdout(
			`${JSON.stringify({ branch: worktree?.branch ?? null, path }, null, 2)}\n`,
		);
		return 0;
	}

	const repository = await detectRepository(path);
	const config = await loadEffectiveConfig(
		repository.repoRoot,
		undefined,
		options.stderr,
	);
	const hooks = extractHooks(config);
	await runHook(
		hooks["after-enter"],
		path,
		{
			branch: worktree?.branch ?? undefined,
			path,
			repo: basename(repository.repoRoot),
		},
		options.stderr,
	);

	await recordWorktreeUsage(path, worktree?.branch ?? null);
	await writeShellOutput(GO_OUTPUT_FILE_ENV, path, options.stdout);
	return 0;
}

function emitAmbiguousCrossRepoError(
	options: GoCommandOptions,
	matches: WorktreePromptSource[],
): number {
	const candidates = matches
		.map(
			(match) => `${match.repoName}/${match.worktree.branch ?? "(detached)"}`,
		)
		.join(", ");
	return emitError(
		options,
		`multiple worktrees match "${options.branch}": ${candidates}`,
	);
}

function emitNoRepositoryError(
	options: GoCommandOptions,
	staleRegisteredRepos: boolean,
): number {
	if (options.json) {
		return emitError(
			options,
			"not in a git repository and no accessible worktrees are registered",
		);
	}

	options.stderr(
		"gji go: not in a git repository and no repos registered yet.\n",
	);
	options.stderr("Use any gji command inside a repository to register it.\n");
	if (staleRegisteredRepos) {
		options.stderr(
			"Hint: Run 'gji doctor' to inspect stale repository entries.\n",
		);
	}
	return 1;
}

function emitNoMatchError(
	options: GoCommandOptions,
	staleRegisteredRepos = false,
): number {
	if (options.json) {
		return emitError(options, `nothing matched "${options.branch}"`);
	}

	options.stderr(`No worktree found for branch: ${options.branch}\n`);
	options.stderr(`gji go: nothing matched "${options.branch}"\n`);
	options.stderr("Hint: Use 'gji ls' to see available worktrees\n");
	options.stderr(
		"  · no worktree or branch named that query in this repository\n" +
			"  · no matching worktree in registered repositories\n" +
			`  · create it: gji new ${options.branch}\n`,
	);
	if (staleRegisteredRepos) {
		options.stderr(
			"Hint: Run 'gji doctor' to inspect stale repository entries.\n",
		);
	}
	return 1;
}

function emitError(options: GoCommandOptions, message: string): number {
	if (options.json) {
		options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
	} else {
		options.stderr(`gji go: ${message}\n`);
	}
	return 1;
}

async function defaultConfirmBranchCreation(branch: string): Promise<boolean> {
	const choice = await confirm({
		message: `branch "${branch}" exists but has no worktree. Create one?`,
		initialValue: true,
	});
	return !isCancel(choice) && choice;
}

async function isPullRequestForRepository(
	repoRoot: string,
	input: string,
): Promise<boolean> {
	if (/^\d+$/.test(input) || /^#\d+$/.test(input)) return true;

	let pullRequestUrl: URL;
	try {
		pullRequestUrl = new URL(input);
	} catch {
		return true;
	}

	const remoteUrl = await getRepositoryRemoteUrl(repoRoot, "origin");
	if (!remoteUrl) return true;

	return (
		normalizeRepositoryUrl(remoteUrl) ===
		normalizeRepositoryUrl(pullRequestUrl.href)
	);
}

function normalizeRepositoryUrl(value: string): string {
	return normalizeRemoteUrl(value).replace(
		/\/(?:pull|pull-requests|merge_requests)\/\d+(?:\/.*)?$/,
		"",
	);
}

function normalizeRemoteUrl(value: string): string {
	const trimmed = value.trim();
	const sshMatch = trimmed.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
	if (sshMatch && !trimmed.includes("://")) {
		return `${sshMatch[1]}/${sshMatch[2]}`
			.replace(/\.git$/, "")
			.replace(/\/$/, "");
	}

	try {
		const url = new URL(trimmed);
		return `${url.host}${url.pathname}`
			.replace(/\.git$/, "")
			.replace(/\/$/, "");
	} catch {
		return trimmed.replace(/\.git$/, "").replace(/\/$/, "");
	}
}

async function promptForWorktree(
	worktrees: WorktreePromptEntry[],
): Promise<string | null> {
	return promptForSingleWorktree("Choose a worktree", worktrees);
}
