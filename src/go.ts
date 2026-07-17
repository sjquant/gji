import { basename } from "node:path";

import { loadEffectiveConfig } from "./config.js";
import { isHeadless } from "./headless.js";
import { recordWorktreeUsage } from "./history.js";
import { extractHooks, runHook } from "./hooks.js";
import { detectRepository, listWorktrees, type WorktreeEntry } from "./repo.js";
import { writeShellOutput } from "./shell-handoff.js";
import { resolveWarpTarget } from "./warp.js";
import {
	buildWorktreePromptEntries,
	promptForSingleWorktree,
	type QueryWorktreePullRequests,
	resolveWorktreeQuery,
	type WorktreePromptEntry,
} from "./worktree-picker.js";

export interface GoCommandOptions {
	branch?: string;
	cwd: string;
	print?: boolean;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export interface GoCommandDependencies {
	promptForWorktree: (
		worktrees: WorktreePromptEntry[],
	) => Promise<string | null>;
	queryPullRequests: QueryWorktreePullRequests;
}

const GO_OUTPUT_FILE_ENV = "GJI_GO_OUTPUT_FILE";

export function createGoCommand(
	dependencies: Partial<GoCommandDependencies> = {},
): (options: GoCommandOptions) => Promise<number> {
	const prompt = dependencies.promptForWorktree ?? promptForWorktree;

	return async function runGoCommand(
		options: GoCommandOptions,
	): Promise<number> {
		let worktrees: WorktreeEntry[];
		let repository: Awaited<ReturnType<typeof detectRepository>>;

		try {
			[worktrees, repository] = await Promise.all([
				listWorktrees(options.cwd),
				detectRepository(options.cwd),
			]);
		} catch {
			// Not inside a git repo — fall back to cross-repo navigation.
			if (isHeadless() && !options.branch) {
				options.stderr(
					"gji go: branch argument is required in non-interactive mode (GJI_NO_TUI=1)\n",
				);
				return 1;
			}
			const target = await resolveWarpTarget({
				...options,
				commandName: "gji go",
			});
			if (!target) return 1;
			await recordWorktreeUsage(target.path, target.branch);
			await writeShellOutput(GO_OUTPUT_FILE_ENV, target.path, options.stdout);
			return 0;
		}

		if (!options.branch && isHeadless()) {
			options.stderr(
				"gji go: branch argument is required in non-interactive mode (GJI_NO_TUI=1)\n",
			);
			return 1;
		}

		const promptSources = worktrees.map((worktree) => ({
			repoRoot: repository.repoRoot,
			repoName: repository.repoName,
			worktree,
		}));
		const promptEntries = options.branch
			? []
			: await buildWorktreePromptEntries(promptSources, {
					queryPullRequests: dependencies.queryPullRequests,
				});
		const queried = options.branch
			? resolveWorktreeQuery(promptSources, options.branch)
			: null;
		const prompted = options.branch ? null : await prompt(promptEntries);
		const resolvedPath = options.branch
			? queried?.worktree.path
			: (prompted ?? undefined);

		if (!resolvedPath) {
			if (options.branch) {
				options.stderr(`No worktree found for branch: ${options.branch}\n`);
				options.stderr(`Hint: Use 'gji ls' to see available worktrees\n`);
			} else {
				options.stderr("Aborted\n");
			}
			return 1;
		}

		const chosenWorktree = worktrees.find((w) => w.path === resolvedPath);

		const config = await loadEffectiveConfig(
			repository.repoRoot,
			undefined,
			options.stderr,
		);
		const hooks = extractHooks(config);
		await runHook(
			hooks["after-enter"],
			resolvedPath,
			{
				branch: chosenWorktree?.branch ?? undefined,
				path: resolvedPath,
				repo: basename(repository.repoRoot),
			},
			options.stderr,
		);

		await recordWorktreeUsage(resolvedPath, chosenWorktree?.branch ?? null);
		await writeShellOutput(GO_OUTPUT_FILE_ENV, resolvedPath, options.stdout);
		return 0;
	};
}

export const runGoCommand = createGoCommand();

async function promptForWorktree(
	worktrees: WorktreePromptEntry[],
): Promise<string | null> {
	return promptForSingleWorktree("Choose a worktree", worktrees);
}
