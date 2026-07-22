import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { validateSyncDirPattern } from "./config.js";
import { directorySize } from "./dir-clone.js";
import { isNotDirectoryError, isNotFoundError } from "./fs-utils.js";

export interface SyncDirectoryPlan {
	directory: string;
	destination: string;
	destinationWasPresent: boolean;
	destinationWarning?: string;
	source?: string;
	warning?: string;
}

export interface SyncDirectoryEstimate {
	bytes: number;
	dir: string;
}

export async function prepareSyncDirectoryPlan(
	repoRoot: string,
	worktreePath: string,
	directories: readonly string[],
): Promise<SyncDirectoryPlan[]> {
	const normalizedDirectories = directories
		.map(validateSyncDirPattern)
		.sort(directoryDepthAscending);
	const plan: SyncDirectoryPlan[] = [];

	for (const directory of normalizedDirectories) {
		const destination = join(worktreePath, directory);
		const destinationState = await inspectDestination(
			worktreePath,
			destination,
		);
		const destinationWasPresent = destinationState === "exists";
		const destinationWarning =
			destinationState === "blocked"
				? "destination has a non-directory ancestor"
				: undefined;
		try {
			const source = await resolveSyncDirectorySource(repoRoot, directory);
			if (!source) {
				plan.push({
					directory,
					destination,
					destinationWasPresent,
					destinationWarning,
				});
			} else if ("warning" in source) {
				plan.push({
					directory,
					destination,
					destinationWasPresent,
					destinationWarning,
					warning: source.warning,
				});
			} else {
				plan.push({
					directory,
					destination,
					destinationWasPresent,
					destinationWarning,
					source: source.path,
				});
			}
		} catch (error) {
			plan.push({
				directory,
				destination,
				destinationWasPresent,
				destinationWarning,
				warning: `could not inspect ${directory}: ${toErrorMessage(error)}`,
			});
		}
	}

	return plan;
}

export async function estimateSyncDirectoryPlan(
	plan: readonly SyncDirectoryPlan[],
): Promise<SyncDirectoryEstimate[]> {
	const estimates: SyncDirectoryEstimate[] = [];
	for (const entry of plan) {
		if (
			entry.destinationWasPresent ||
			entry.destinationWarning ||
			!entry.source ||
			entry.warning ||
			isCoveredByCloneAncestor(entry, plan)
		) {
			continue;
		}

		try {
			estimates.push({
				bytes: await directorySize(entry.source),
				dir: entry.directory,
			});
		} catch {
			// A dry-run is informational; an unreadable source is omitted.
		}
	}

	return estimates;
}

export async function estimateSyncDirectories(
	repoRoot: string,
	worktreePath: string,
	directories: readonly string[],
): Promise<SyncDirectoryEstimate[]> {
	const plan = await prepareSyncDirectoryPlan(
		repoRoot,
		worktreePath,
		directories,
	);
	return estimateSyncDirectoryPlan(plan);
}

async function resolveSyncDirectorySource(
	repoRoot: string,
	directory: string,
): Promise<{ path: string } | { warning: string } | null> {
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
	if (!stats.isDirectory()) return { warning: "source is not a directory" };

	return { path: resolvedSource };
}

function isCoveredByCloneAncestor(
	entry: SyncDirectoryPlan,
	plan: readonly SyncDirectoryPlan[],
): boolean {
	return plan.some(
		(candidate) =>
			candidate !== entry &&
			!candidate.destinationWasPresent &&
			!candidate.destinationWarning &&
			!!candidate.source &&
			isPathInside(candidate.directory, entry.directory),
	);
}

function directoryDepthAscending(left: string, right: string): number {
	return left.split(/[\\/]+/u).length - right.split(/[\\/]+/u).length;
}

function isPathInside(parent: string, child: string): boolean {
	const relativePath = relative(resolve(parent), resolve(child));
	return (
		relativePath !== "" &&
		!isAbsolute(relativePath) &&
		relativePath !== ".." &&
		!relativePath.startsWith(`..${sep}`)
	);
}

async function inspectDestination(
	root: string,
	path: string,
): Promise<"exists" | "missing" | "blocked"> {
	const relativePath = relative(resolve(root), resolve(path));
	if (
		isAbsolute(relativePath) ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`)
	) {
		return "blocked";
	}

	let current = resolve(root);
	const segments = relativePath.split(sep).filter(Boolean);
	for (const [index, segment] of segments.entries()) {
		current = join(current, segment);
		try {
			const stats = await lstat(current);
			if (index < segments.length - 1) {
				if (stats.isSymbolicLink() || !stats.isDirectory()) return "blocked";
			} else {
				return "exists";
			}
		} catch (error) {
			if (isNotFoundError(error)) return "missing";
			if (isNotDirectoryError(error)) return "blocked";
			throw error;
		}
	}

	try {
		const stats = await lstat(current);
		return stats.isSymbolicLink() || !stats.isDirectory()
			? "blocked"
			: "exists";
	} catch (error) {
		if (isNotFoundError(error)) return "missing";
		throw error;
	}
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
