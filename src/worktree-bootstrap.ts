import { lstat, realpath, unlink } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { GjiConfig } from "./config.js";
import { validateSyncDirPattern } from "./config.js";
import {
	type CloneDirectory,
	type CloneDirResult,
	cacheCloneFailure,
	clearCloneFailure,
	cloneDir,
	directorySize,
	isCloneDestinationExistsError,
	isCloneFailureCached,
	isCloneUnsupportedError,
} from "./dir-clone.js";
import { syncFiles } from "./file-sync.js";
import { extractHooks, runHook } from "./hooks.js";
import {
	type InstallPromptDependencies,
	maybeRunInstallPrompt,
} from "./install-prompt.js";
import { detectPackageManager } from "./package-manager.js";

export interface SyncDirEstimate {
	bytes: number;
	dir: string;
}

export interface ClonedDir extends SyncDirEstimate {
	installSkipped: boolean;
	ms: number;
}

export interface WorktreeBootstrapOptions {
	branch: string;
	cloneDirectory?: CloneDirectory;
	config: GjiConfig;
	json?: boolean;
	repoRoot: string;
	stderr: (chunk: string) => void;
	worktreePath: string;
	installDependencies?: InstallPromptDependencies;
}

export async function bootstrapWorktree(
	options: WorktreeBootstrapOptions,
): Promise<ClonedDir[]> {
	const clonedDirs = await syncConfiguredDirs(
		options.repoRoot,
		options.worktreePath,
		options.config,
		options.stderr,
		!!options.json,
		options.cloneDirectory,
	);

	const syncPatterns = Array.isArray(options.config.syncFiles)
		? (options.config.syncFiles as unknown[]).filter(
				(pattern): pattern is string => typeof pattern === "string",
			)
		: [];
	for (const pattern of syncPatterns) {
		try {
			await syncFiles(options.repoRoot, options.worktreePath, [pattern]);
		} catch (error) {
			options.stderr(
				`Warning: failed to sync file "${pattern}": ${toErrorMessage(error)}\n`,
			);
		}
	}

	await maybeRunInstallPrompt(
		options.worktreePath,
		options.repoRoot,
		options.config,
		options.stderr,
		options.installDependencies,
		!!options.json,
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
		options.stderr,
	);

	return clonedDirs;
}

export async function estimateSyncDirs(
	repoRoot: string,
	worktreePath: string,
	config: GjiConfig,
): Promise<SyncDirEstimate[]> {
	const estimates: SyncDirEstimate[] = [];
	for (const directory of configuredSyncDirs(config)) {
		if (await pathExists(join(worktreePath, directory))) continue;

		let source: SyncDirSource;
		try {
			source = await resolveSyncDirSource(repoRoot, directory);
		} catch {
			continue;
		}
		if (!source?.path) continue;

		try {
			estimates.push({
				bytes: await directorySize(source.path),
				dir: directory,
			});
		} catch {
			// A dry-run is informational; an unreadable source is omitted.
		}
	}

	return estimates;
}

export async function syncConfiguredDirs(
	repoRoot: string,
	worktreePath: string,
	config: GjiConfig,
	stderr: (chunk: string) => void,
	json: boolean,
	cloneDirectory: CloneDirectory = cloneDir,
): Promise<ClonedDir[]> {
	const directories = configuredSyncDirs(config);
	if (directories.length === 0) return [];

	const targetPackageManager = directories.includes("node_modules")
		? ((await detectPackageManager(worktreePath)) ??
			(await detectPackageManager(repoRoot)))
		: null;
	const isPnpm = targetPackageManager?.name === "pnpm";
	const cloned: ClonedDir[] = [];

	for (const directory of directories) {
		const destination = join(worktreePath, directory);
		if (await pathExists(destination)) continue;

		let source: SyncDirSource;
		try {
			source = await resolveSyncDirSource(repoRoot, directory);
		} catch (error) {
			stderr(
				`syncDirs: could not inspect ${directory}: ${toErrorMessage(error)}, skipped ${directory}\n`,
			);
			continue;
		}
		if (!source) continue;
		if (!source.path) {
			stderr(`syncDirs: ${source.warning}, skipped ${directory}\n`);
			continue;
		}

		if (await isCloneFailureCached(repoRoot, directory)) {
			if (!json) {
				stderr(
					`syncDirs: previous copy-on-write failure cached, skipped ${directory}\n`,
				);
			}
			continue;
		}

		let result: CloneDirResult;
		try {
			result = await cloneDirectory(source.path, destination);
		} catch (error) {
			if (isCloneDestinationExistsError(error)) continue;

			const reason = toErrorMessage(error);
			if (isCloneUnsupportedError(error)) {
				await cacheCloneFailure(repoRoot, directory, reason);
				stderr(
					`syncDirs: filesystem doesn't support copy-on-write (${reason}), skipped ${directory}\n`,
				);
			} else {
				stderr(`syncDirs: clone failed (${reason}), skipped ${directory}\n`);
			}
			continue;
		}

		await clearCloneFailure(repoRoot, directory);
		let installSkipped = false;
		if (directory === "node_modules" && isPnpm) {
			try {
				await unlink(join(destination, ".modules.yaml"));
				installSkipped = true;
			} catch (error) {
				if (isNotFoundError(error)) {
					installSkipped = true;
				} else {
					stderr(
						`syncDirs: could not remove pnpm .modules.yaml: ${toErrorMessage(error)}\n`,
					);
				}
			}
		} else if (directory === "node_modules") {
			installSkipped = true;
		}

		const clonedDir = {
			bytes: result.bytes,
			dir: directory,
			installSkipped,
			ms: result.ms,
		};
		cloned.push(clonedDir);
		if (!json) {
			stderr(
				`⚡ cloned ${directory} (${formatBytes(result.bytes)} → ${formatDuration(result.ms)})${installSkipped ? " — run install only if lockfile changed" : ""}\n`,
			);
		}
	}

	return cloned;
}

type SyncDirSource =
	| { path: string; warning?: undefined }
	| { path?: undefined; warning: string }
	| null;

function configuredSyncDirs(config: GjiConfig): string[] {
	if (!Array.isArray(config.syncDirs)) return [];

	return config.syncDirs
		.filter((value): value is string => typeof value === "string")
		.map(validateSyncDirPattern);
}

async function resolveSyncDirSource(
	repoRoot: string,
	directory: string,
): Promise<SyncDirSource> {
	const source = join(repoRoot, directory);
	let resolvedSource: string;
	try {
		resolvedSource = await realpath(source);
	} catch (error) {
		if (isNotFoundError(error)) return null;
		throw error;
	}

	if (!isPathInside(repoRoot, resolvedSource)) {
		return {
			warning: `source symlink resolves outside the repository (${resolvedSource})`,
		};
	}

	const stats = await lstat(resolvedSource);
	if (!stats.isDirectory()) {
		return { warning: "source is not a directory" };
	}

	return { path: resolvedSource };
}

function isPathInside(parent: string, child: string): boolean {
	const relativePath = relative(resolve(parent), resolve(child));
	return (
		relativePath === "" ||
		(!isAbsolute(relativePath) &&
			relativePath !== ".." &&
			!relativePath.startsWith(`..${sep}`))
	);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = -1;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (isNotFoundError(error)) return false;
		throw error;
	}
}

function isNotFoundError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
