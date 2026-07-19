import { basename } from "node:path";

import { confirm, isCancel } from "@clack/prompts";
import { runBackCommand } from "./back.js";
import { loadEffectiveConfig } from "./config.js";
import { type GoBranchResolution, resolveGoBranch } from "./go-resolver.js";
import { isHeadless } from "./headless.js";
import { recordWorktreeUsage } from "./history.js";
import { extractHooks, runHook } from "./hooks.js";
import {
	createNavigationRepository,
	createNavigationTarget,
} from "./navigation-output.js";
import { runNewCommand } from "./new.js";
import { runPrCommand } from "./pr.js";
import {
	detectRepository,
	listWorktrees,
	type RepositoryContext,
	type WorktreeEntry,
} from "./repo.js";
import { writeShellOutput } from "./shell-handoff.js";
import {
	buildWorktreePromptEntries,
	promptForSingleWorktree,
	type QueryWorktreePullRequests,
	type WorktreePromptEntry,
	type WorktreePromptScope,
} from "./worktree-picker.js";
import type { WorktreeSource } from "./worktree-source.js";
import { listRegisteredWorktreeSources } from "./worktree-sources.js";

export interface GoCommandOptions {
	branch?: string;
	cwd: string;
	json?: boolean;
	print?: boolean;
	root?: boolean;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export interface GoCommandDependencies {
	confirmBranchCreation: (branch: string) => Promise<boolean>;
	promptForWorktree: (
		worktrees: WorktreePromptEntry[],
		scope?: WorktreePromptScope,
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
		if (options.root) {
			if (options.branch !== undefined) {
				return emitError(options, "--root cannot be combined with a branch");
			}

			return navigateToRepositoryRoot(options);
		}

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
			let registeredSources: WorktreeSource[] | null = null;
			let promptSources = currentSources;
			const loadAllSources = async (): Promise<WorktreeSource[]> => {
				if (registeredSources === null) {
					registeredSources = await listRegisteredWorktreeSources(
						options.cwd,
						() => {
							skippedRegisteredRepos++;
						},
					);
				}

				return deduplicateSources([...currentSources, ...registeredSources]);
			};

			if (!repository) {
				promptSources = await loadAllSources();
			}

			if (promptSources.length === 0 && !repository) {
				return emitNoRepositoryError(options, skippedRegisteredRepos > 0);
			}

			let currentRepositoryScope = true;
			let scope: WorktreePromptScope | undefined;
			if (repository) {
				scope = {
					label: "current repository",
					toggleLabel: "all repositories",
					toggle: async () => {
						const nextCurrentRepositoryScope = !currentRepositoryScope;
						const nextSources = nextCurrentRepositoryScope
							? currentSources
							: await loadAllSources();
						currentRepositoryScope = nextCurrentRepositoryScope;
						promptSources = nextSources;
						return {
							entries: await buildWorktreePromptEntries(promptSources, {
								metadata: currentRepositoryScope ? "full" : "fast",
								queryPullRequests: dependencies.queryPullRequests,
							}),
							label: currentRepositoryScope
								? "current repository"
								: "all repositories",
							toggleLabel: currentRepositoryScope
								? "all repositories"
								: "current repository",
						};
					},
				};
			}
			const promptEntries = await buildWorktreePromptEntries(promptSources, {
				metadata: repository ? "full" : "fast",
				queryPullRequests: dependencies.queryPullRequests,
			});
			const selectedPath = await prompt(promptEntries, scope);
			if (!selectedPath) {
				options.stderr("Aborted\n");
				return 1;
			}

			const selected = promptSources.find(
				(source) => source.worktree.path === selectedPath,
			);
			return navigateToExistingWorktree(
				options,
				selectedPath,
				selected?.worktree,
			);
		}

		const resolution = await resolveGoBranch({
			branch: options.branch,
			configStderr: options.json ? undefined : options.stderr,
			cwd: options.cwd,
			currentSources,
			repository,
		});
		return handleGoBranchResolution(
			options,
			resolution,
			confirmBranchCreation,
			prompt,
			dependencies.queryPullRequests,
		);
	};
}

export const runGoCommand = createGoCommand();

async function handleGoBranchResolution(
	options: GoCommandOptions,
	resolution: GoBranchResolution,
	confirmBranchCreation: GoCommandDependencies["confirmBranchCreation"],
	prompt: GoCommandDependencies["promptForWorktree"],
	queryPullRequests?: QueryWorktreePullRequests,
): Promise<number> {
	switch (resolution.kind) {
		case "existing":
			return navigateToExistingWorktree(
				options,
				resolution.source.worktree.path,
				resolution.source.worktree,
			);
		case "ambiguous": {
			if (options.json || isHeadless() || options.print) {
				return emitAmbiguousCrossRepoError(options, resolution.matches);
			}

			const candidates = await buildWorktreePromptEntries(resolution.matches, {
				metadata: "fast",
				queryPullRequests,
			});
			const selectedPath = await prompt(candidates);
			if (!selectedPath) {
				options.stderr("Aborted\n");
				return 1;
			}
			const selected = resolution.matches.find(
				(source) => source.worktree.path === selectedPath,
			);
			return navigateToExistingWorktree(
				options,
				selectedPath,
				selected?.worktree,
			);
		}
		case "create":
			return createExistingBranchWorktree(
				options,
				confirmBranchCreation,
				resolution.repository,
				resolution.branch,
				resolution.mode,
				resolution.remote,
			);
		case "pull-request":
			if (options.json || isHeadless() || options.print) {
				return emitError(
					options,
					"PR navigation creates a worktree; use `gji pr <ref>` in an interactive shell",
				);
			}

			return runPrCommand({
				cwd: resolution.repository.repoRoot,
				number: resolution.input,
				outputEnv: GO_OUTPUT_FILE_ENV,
				stderr: options.stderr,
				stdout: options.stdout,
			});
		case "no-repository":
			return emitNoRepositoryError(options, resolution.staleRegisteredRepos);
		case "no-match":
			return emitNoMatchError(options, resolution.staleRegisteredRepos);
		case "error":
			return emitError(options, resolution.message);
	}
}

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
): WorktreeSource[] {
	return worktrees.map((worktree) => ({ repoName, repoRoot, worktree }));
}

function deduplicateSources(sources: WorktreeSource[]): WorktreeSource[] {
	const seen = new Set<string>();
	const deduplicated: WorktreeSource[] = [];
	for (const source of sources) {
		if (seen.has(source.worktree.path)) continue;
		seen.add(source.worktree.path);
		deduplicated.push(source);
	}
	return deduplicated;
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
	const repository = await detectRepository(path);

	if (options.json) {
		options.stdout(
			`${JSON.stringify(
				createNavigationTarget(
					createNavigationRepository(repository.repoName, repository.repoRoot),
					path,
					worktree?.branch ?? null,
				),
				null,
				2,
			)}\n`,
		);
		return 0;
	}

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

async function navigateToRepositoryRoot(
	options: GoCommandOptions,
): Promise<number> {
	let repository: RepositoryContext;
	try {
		repository = await detectRepository(options.cwd);
	} catch {
		return emitError(options, "not inside a git repository");
	}

	if (options.json) {
		const rootWorktree = (await listWorktrees(repository.repoRoot)).find(
			(worktree) => worktree.path === repository.repoRoot,
		);
		options.stdout(
			`${JSON.stringify(
				createNavigationTarget(
					createNavigationRepository(repository.repoName, repository.repoRoot),
					repository.repoRoot,
					rootWorktree?.branch ?? null,
				),
				null,
				2,
			)}\n`,
		);
		return 0;
	}

	if (options.print) {
		options.stdout(`${repository.repoRoot}\n`);
		return 0;
	}

	await writeShellOutput(
		GO_OUTPUT_FILE_ENV,
		repository.repoRoot,
		options.stdout,
	);
	return 0;
}

function emitAmbiguousCrossRepoError(
	options: GoCommandOptions,
	matches: WorktreeSource[],
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

async function promptForWorktree(
	worktrees: WorktreePromptEntry[],
	scope?: WorktreePromptScope,
): Promise<string | null> {
	return promptForSingleWorktree("Choose a worktree", worktrees, { scope });
}
