import { basename } from "node:path";

import type { DependencyBootstrapMode, EffectiveGjiConfig } from "./config.js";
import {
	type BootstrapCommandRunner,
	type BootstrapEvent,
	type DependencyBootstrapReport,
	type DependencyBootstrapReporter,
	executeDependencyBootstrap,
	prepareDependencyBootstrap,
} from "./dependency-bootstrap.js";
import { type CloneDirectory, cloneDir } from "./dir-clone.js";
import { syncFiles } from "./file-sync.js";
import { extractHooks, runHook } from "./hooks.js";
import {
	type InstallPromptDependencies,
	maybeRunInstallPrompt,
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
	runCommand?: BootstrapCommandRunner;
	commandStdout?: (chunk: string) => void;
	commandStderr?: (chunk: string) => void;
	json?: boolean;
	nonInteractive: boolean;
	repoRoot: string;
	reporter: SyncDirectoryReporter & DependencyBootstrapReporter;
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
		cargoBuildCommand: options.config.dependencyBuildCommand,
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

	const syncFileFailures: BootstrapEvent[] = [];
	for (const pattern of options.config.syncFiles ?? []) {
		try {
			await syncFiles(options.repoRoot, options.worktreePath, [pattern]);
		} catch (error) {
			const message = `failed to sync file "${pattern}": ${toErrorMessage(error)}`;
			if (!options.json) options.reporter.write(`Warning: ${message}\n`);
			syncFileFailures.push({
				adapter: "syncFiles",
				kind: "sync-file",
				reason: "sync-file-failed",
				state: "failed",
				target: pattern,
				message,
			});
		}
	}

	const dependencyBootstrap =
		syncFileFailures.length > 0
			? reportSyncFileFailure(
					dependencyMode,
					syncFileFailures,
					options.reporter,
				)
			: await executeDependencyBootstrap(dependencyPlan, {
					cloneDirectory: options.cloneDirectory,
					repoRoot: options.repoRoot,
					reporter: options.reporter,
					stderr: options.commandStderr ?? options.reporter.write,
					stdout: options.commandStdout,
					seededDirectories: clonedDirs.map(({ dir }) => dir),
					runCommand: options.runCommand,
				});

	if (!dependencyBootstrap.ready) {
		return {
			clonedDirs,
			dependencyBootstrap,
			ready: false,
			skippedDirs,
		};
	}

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
		options.json
			? () => undefined
			: (options.commandStdout ?? ((chunk) => process.stdout.write(chunk))),
	);

	return { clonedDirs, dependencyBootstrap, ready: true, skippedDirs };
}

function reportSyncFileFailure(
	mode: DependencyBootstrapMode,
	events: readonly BootstrapEvent[],
	reporter: DependencyBootstrapReporter,
): DependencyBootstrapReport {
	for (const event of events) reporter.dependency(event);
	return { mode, ready: false, events };
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
