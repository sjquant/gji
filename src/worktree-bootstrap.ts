import { basename } from "node:path";

import type { EffectiveGjiConfig } from "./config.js";
import {
	type BootstrapCommandRunner,
	type BootstrapEvent,
	type DependencyBootstrapMode,
	type DependencyBootstrapReport,
	type DependencyBootstrapReporter,
	executeDependencyBootstrap,
	prepareDependencyBootstrap,
} from "./dependency-bootstrap.js";
import { syncFiles } from "./file-sync.js";
import { extractHooks, runHook } from "./hooks.js";
import { assignWorktreeSlot } from "./slots.js";
export interface WorktreeBootstrapOptions {
	branch: string;
	config: EffectiveGjiConfig;
	currentRoot?: string;
	dependencyDetectionRoot?: string;
	dependencyMode?: DependencyBootstrapMode;
	runCommand?: BootstrapCommandRunner;
	commandStdout?: (chunk: string) => void;
	commandStderr?: (chunk: string) => void;
	json?: boolean;
	repoRoot: string;
	reporter: DependencyBootstrapReporter & { write: (chunk: string) => void };
	worktreePath: string;
}

export interface WorktreeBootstrapResult {
	dependencyBootstrap: DependencyBootstrapReport;
	ready: boolean;
	syncFileFailures: readonly BootstrapEvent[];
}

export async function bootstrapWorktree(
	options: WorktreeBootstrapOptions,
): Promise<WorktreeBootstrapResult> {
	const dependencyMode = options.dependencyMode ?? "install";
	const dependencyPlan = await prepareDependencyBootstrap(dependencyMode, {
		currentRoot: options.currentRoot,
		detectionRoot: options.dependencyDetectionRoot,
		repoRoot: options.repoRoot,
		cargoBuildCommand: options.config.dependencyBuildCommand,
		worktreePath: options.worktreePath,
	});
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

	if (syncFileFailures.length > 0) {
		for (const event of syncFileFailures) options.reporter.dependency(event);
	}
	const dependencyBootstrap =
		syncFileFailures.length > 0
			? { mode: dependencyMode, ready: false, events: [] }
			: await executeDependencyBootstrap(dependencyPlan, {
					reporter: options.reporter,
					stderr: options.commandStderr ?? options.reporter.write,
					stdout: options.commandStdout,
					runCommand: options.runCommand,
				});

	if (!dependencyBootstrap.ready) {
		return {
			dependencyBootstrap,
			ready: false,
			syncFileFailures,
		};
	}

	const hooks = extractHooks(options.config);
	const slot = await assignWorktreeSlot(options.repoRoot, options.worktreePath);
	await runHook(
		hooks["after-create"],
		options.worktreePath,
		{
			branch: options.branch,
			path: options.worktreePath,
			repo: basename(options.repoRoot),
			slot,
		},
		options.reporter.write,
		options.json
			? () => undefined
			: (options.commandStdout ?? ((chunk) => process.stdout.write(chunk))),
	);

	return {
		dependencyBootstrap,
		ready: true,
		syncFileFailures: [],
	};
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
