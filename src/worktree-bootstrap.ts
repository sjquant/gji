import { basename } from "node:path";

import type { EffectiveGjiConfig } from "./config.js";
import {
	type DependencyBootstrapReport,
	executeDependencyBootstrap,
	prepareDependencyBootstrap,
} from "./dependency-bootstrap.js";
import { type CloneDirectory, cloneDir } from "./dir-clone.js";
import { syncFiles } from "./file-sync.js";
import { extractHooks, runHook } from "./hooks.js";
import {
	type InstallPromptDependencies,
	maybeRunInstallPrompt,
	runInstallCommand,
} from "./install-prompt.js";
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
	currentRoot?: string;
	installDependencies?: InstallPromptDependencies;
	nonInteractive: boolean;
	repoRoot: string;
	reporter: SyncDirectoryReporter;
	worktreePath: string;
}

export interface WorktreeBootstrapResult {
	clonedDirs: readonly ClonedDirectory[];
	dependencyBootstrap: DependencyBootstrapReport;
	ready: boolean;
	skippedDirs: readonly { dir: string; reason: string }[];
}

export async function bootstrapWorktree(
	options: WorktreeBootstrapOptions,
): Promise<WorktreeBootstrapResult> {
	const dependencyMode = options.config.dependencyBootstrap ?? "off";
	const dependencyPlan = await prepareDependencyBootstrap(dependencyMode, {
		currentRoot: options.currentRoot,
		repoRoot: options.repoRoot,
		runCommand:
			options.installDependencies?.runInstallCommand ?? runInstallCommand,
		stderr: options.reporter.write,
		worktreePath: options.worktreePath,
	});
	const syncPlan = await prepareSyncDirectoryPlan(
		options.repoRoot,
		options.worktreePath,
		options.config.syncDirs ?? [],
	);
	const outcomes = await executeSyncDirectoryPlan(syncPlan, {
		cloneDirectory: options.cloneDirectory ?? cloneDir,
		repoRoot: options.repoRoot,
		reporter: options.reporter,
	});
	const clonedDirs = outcomes.flatMap((outcome) =>
		outcome.kind === "cloned" ? [outcome.directory] : [],
	);
	const skippedDirs = outcomes.flatMap((outcome) =>
		outcome.kind === "skipped"
			? [{ dir: outcome.dir, reason: outcome.reason }]
			: [],
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

	const dependencyBootstrap = await executeDependencyBootstrap(dependencyPlan, {
		cloneDirectory: options.cloneDirectory,
		repoRoot: options.repoRoot,
		reporter: options.reporter,
		runCommand:
			options.installDependencies?.runInstallCommand ?? runInstallCommand,
	});

	if (dependencyMode === "off") {
		await maybeRunInstallPrompt(
			options.worktreePath,
			options.repoRoot,
			options.config,
			options.reporter.write,
			options.installDependencies,
			options.nonInteractive,
		);
	}

	if (!dependencyBootstrap.ready) {
		return {
			clonedDirs,
			dependencyBootstrap,
			ready: false,
			skippedDirs,
		};
	}

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

	return { clonedDirs, dependencyBootstrap, ready: true, skippedDirs };
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
