import { basename } from "node:path";

import type { EffectiveGjiConfig } from "./config.js";
import { type CloneDirectory, cloneDir } from "./dir-clone.js";
import { syncFiles } from "./file-sync.js";
import { extractHooks, runHook } from "./hooks.js";
import {
	type InstallPromptDependencies,
	maybeRunInstallPrompt,
} from "./install-prompt.js";
import { createDependencyClonePostProcessor } from "./package-manager.js";
import {
	type ClonedDirectory,
	executeSyncDirectoryPlan,
	type SyncDirectoryReporter,
} from "./sync-directories.js";
import { prepareSyncDirectoryPlan } from "./sync-plan.js";

export type { ClonedDirectory as ClonedDir } from "./sync-directories.js";

export interface WorktreeBootstrapOptions {
	branch: string;
	cloneDirectory?: CloneDirectory;
	config: EffectiveGjiConfig;
	installDependencies?: InstallPromptDependencies;
	nonInteractive: boolean;
	repoRoot: string;
	reporter: SyncDirectoryReporter;
	worktreePath: string;
}

export async function bootstrapWorktree(
	options: WorktreeBootstrapOptions,
): Promise<ClonedDirectory[]> {
	const directories = options.config.syncDirs ?? [];
	const plan = await prepareSyncDirectoryPlan(
		options.repoRoot,
		options.worktreePath,
		directories,
	);
	const postProcessor = await createDependencyClonePostProcessor(
		options.worktreePath,
		options.repoRoot,
		directories,
	);
	const outcomes = await executeSyncDirectoryPlan(plan, {
		cloneDirectory: options.cloneDirectory ?? cloneDir,
		postProcessor,
		repoRoot: options.repoRoot,
		reporter: options.reporter,
	});
	const clonedDirs = outcomes.flatMap((outcome) =>
		outcome.kind === "cloned" ? [outcome.directory] : [],
	);

	for (const pattern of options.config.syncFiles ?? []) {
		try {
			await syncFiles(options.repoRoot, options.worktreePath, [pattern]);
		} catch (error) {
			options.reporter.write(
				`Warning: failed to sync file "${pattern}": ${toErrorMessage(error)}\n`,
			);
		}
	}

	await maybeRunInstallPrompt(
		options.worktreePath,
		options.repoRoot,
		options.config,
		options.reporter.write,
		options.installDependencies,
		options.nonInteractive,
		clonedDirs.some(
			({ dir, installSkipped }) => dir === "node_modules" && installSkipped,
		),
	);

	const hooks = extractHooks(options.config);
	await runHook(
		hooks["after-create"],
		options.worktreePath,
		{
			branch: options.branch,
			path: options.worktreePath,
			repo: basename(options.repoRoot),
		},
		options.reporter.write,
	);

	return clonedDirs;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
