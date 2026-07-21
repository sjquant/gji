import { lstat } from "node:fs/promises";
import {
	type CloneFailureStore,
	defaultCloneFailureStore,
} from "./clone-failure-store.js";
import type {
	CloneDirectory,
	CloneDirResult,
	CloneRequestOptions,
} from "./dir-clone.js";
import {
	isCloneDestinationExistsError,
	isCloneInProgressError,
	isCloneUnsupportedError,
} from "./dir-clone.js";
import type { SyncDirectoryPlan } from "./sync-plan.js";

export interface ClonedDirectory {
	bytes?: number;
	dir: string;
	ms: number;
}

export type SyncDirectoryOutcome =
	| { kind: "cloned"; directory: ClonedDirectory }
	| { kind: "skipped"; dir: string; reason: string };

export interface SyncDirectoryReporter {
	readonly emitCachedFailureWarnings: boolean;
	readonly measureCloneSize: boolean;
	write(message: string): void;
	cloned(directory: ClonedDirectory): void;
	skipped?(directory: { dir: string; reason: string }): void;
	dependency?(event: {
		adapter: string;
		kind: "dependency" | "build-cache";
		state:
			| "seeded"
			| "repaired"
			| "installed"
			| "fallback"
			| "skipped"
			| "failed";
		target: string;
		message: string;
	}): void;
}

export interface SyncDirectoryExecutionOptions {
	cloneDirectory: CloneDirectory;
	failureStore?: CloneFailureStore;
	repoRoot: string;
	reporter: SyncDirectoryReporter;
}

export async function executeSyncDirectoryPlan(
	plan: readonly SyncDirectoryPlan[],
	options: SyncDirectoryExecutionOptions,
): Promise<SyncDirectoryOutcome[]> {
	const failureStore = options.failureStore ?? defaultCloneFailureStore;
	const outcomes: SyncDirectoryOutcome[] = [];

	for (const entry of plan) {
		if (entry.destinationWarning) {
			recordSkipped(
				outcomes,
				options.reporter,
				entry.directory,
				entry.destinationWarning,
			);
			continue;
		}

		const destinationState = await inspectDestination(entry.destination);
		if (destinationState === "exists") {
			recordSkipped(
				outcomes,
				options.reporter,
				entry.directory,
				"destination already exists",
			);
			continue;
		}
		if (destinationState === "blocked") {
			const reason = "destination has a non-directory ancestor";
			recordSkipped(outcomes, options.reporter, entry.directory, reason);
			continue;
		}

		if (entry.warning) {
			recordSkipped(outcomes, options.reporter, entry.directory, entry.warning);
			continue;
		}
		if (!entry.source) {
			recordSkipped(
				outcomes,
				options.reporter,
				entry.directory,
				"source does not exist",
			);
			continue;
		}

		if (await failureStore.isCached(options.repoRoot, entry.directory)) {
			if (
				options.reporter.emitCachedFailureWarnings ||
				options.reporter.skipped
			) {
				recordSkipped(
					outcomes,
					options.reporter,
					entry.directory,
					"copy-on-write failure cached",
				);
			} else {
				options.reporter.write(
					`syncDirs: previous copy-on-write failure cached, skipped ${entry.directory}\n`,
				);
				recordSkipped(
					outcomes,
					options.reporter,
					entry.directory,
					"copy-on-write failure cached",
					false,
				);
			}
			continue;
		}

		let result: CloneDirResult;
		try {
			const cloneOptions: CloneRequestOptions = {
				measureBytes: options.reporter.measureCloneSize,
			};
			result = await options.cloneDirectory(
				entry.source,
				entry.destination,
				cloneOptions,
			);
		} catch (error) {
			if (isCloneDestinationExistsError(error)) {
				recordSkipped(
					outcomes,
					options.reporter,
					entry.directory,
					"destination already exists",
				);
				continue;
			}
			if (isCloneInProgressError(error)) {
				const reason = "copy-on-write clone already in progress";
				options.reporter.write(
					`syncDirs: ${reason}, skipped ${entry.directory}\n`,
				);
				recordSkipped(outcomes, options.reporter, entry.directory, reason);
				continue;
			}

			const reason = toErrorMessage(error);
			if (isCloneUnsupportedError(error)) {
				await failureStore.cache(options.repoRoot, entry.directory, reason);
				options.reporter.write(
					`syncDirs: filesystem doesn't support copy-on-write (${reason}), skipped ${entry.directory}\n`,
				);
			} else {
				options.reporter.write(
					`syncDirs: clone failed (${reason}), skipped ${entry.directory}\n`,
				);
			}
			recordSkipped(outcomes, options.reporter, entry.directory, reason, false);
			continue;
		}

		await failureStore.clear(options.repoRoot, entry.directory);
		const clonedDirectory: ClonedDirectory = {
			bytes: result.bytes,
			dir: entry.directory,
			ms: result.ms,
		};
		const outcome = { kind: "cloned" as const, directory: clonedDirectory };
		outcomes.push(outcome);
		options.reporter.cloned(clonedDirectory);
	}

	return outcomes;
}

function recordSkipped(
	outcomes: SyncDirectoryOutcome[],
	reporter: SyncDirectoryReporter,
	dir: string,
	reason: string,
	notify = true,
): void {
	outcomes.push({ kind: "skipped", dir, reason });
	if (notify) {
		if (reporter.skipped) reporter.skipped({ dir, reason });
		else reporter.write(`syncDirs: ${reason}, skipped ${dir}\n`);
	}
}

async function inspectDestination(
	path: string,
): Promise<"exists" | "missing" | "blocked"> {
	try {
		await lstat(path);
		return "exists";
	} catch (error) {
		if (isNotFoundError(error)) return "missing";
		if (isNotDirectoryError(error)) return "blocked";
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

function isNotDirectoryError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOTDIR"
	);
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
