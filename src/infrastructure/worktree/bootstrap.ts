import { basename } from "node:path";
import type {
	BootstrapEvent,
	WorktreeBootstrapOptions,
	WorktreeBootstrapResult,
} from "../../ports/bootstrap.js";
import {
	executeDependencyBootstrap,
	prepareDependencyBootstrap,
} from "../bootstrap/dependency-bootstrap.js";
import { syncFiles } from "../filesystem/file-sync.js";
import { assignWorktreeSlot } from "../persistence/slots.js";
import { extractHooks, runHook } from "../process/hooks.js";

export type {
	WorktreeBootstrapOptions,
	WorktreeBootstrapResult,
} from "../../ports/bootstrap.js";

export async function bootstrapWorktree(
	options: WorktreeBootstrapOptions,
): Promise<WorktreeBootstrapResult> {
	const dependencyMode = options.dependencyMode;
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
			options.commandStderr?.(`Warning: ${message}\n`);
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
					stderr: options.commandStderr,
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
		options.commandStderr ?? (() => undefined),
		options.commandStdout ?? (() => undefined),
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
