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
	isCloneUnsupportedError,
} from "./dir-clone.js";
import type { SyncDirectoryPlan } from "./sync-plan.js";

export interface ClonedDirectory {
	bytes?: number;
	dir: string;
	installSkipped: boolean;
	ms: number;
}

export type SyncDirectoryOutcome =
	| { kind: "cloned"; directory: ClonedDirectory }
	| { kind: "skipped"; dir: string; reason: string };

export interface SyncDirectoryPostProcessor {
	postProcess(
		directory: string,
		destination: string,
	): Promise<{ installSkipped: boolean; warning?: string } | undefined>;
}

export interface SyncDirectoryReporter {
	readonly emitCachedFailureWarnings: boolean;
	readonly measureCloneSize: boolean;
	write(message: string): void;
	cloned(directory: ClonedDirectory): void;
}

export interface SyncDirectoryExecutionOptions {
	cloneDirectory: CloneDirectory;
	failureStore?: CloneFailureStore;
	postProcessor?: SyncDirectoryPostProcessor;
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
		if (await pathExists(entry.destination)) {
			outcomes.push({
				kind: "skipped",
				dir: entry.directory,
				reason: "destination already exists",
			});
			continue;
		}

		if (entry.warning) {
			options.reporter.write(
				`syncDirs: ${entry.warning}, skipped ${entry.directory}\n`,
			);
			outcomes.push({
				kind: "skipped",
				dir: entry.directory,
				reason: entry.warning,
			});
			continue;
		}
		if (!entry.source) {
			outcomes.push({
				kind: "skipped",
				dir: entry.directory,
				reason: "source does not exist",
			});
			continue;
		}

		if (await failureStore.isCached(options.repoRoot, entry.directory)) {
			if (options.reporter.emitCachedFailureWarnings) {
				options.reporter.write(
					`syncDirs: previous copy-on-write failure cached, skipped ${entry.directory}\n`,
				);
			}
			outcomes.push({
				kind: "skipped",
				dir: entry.directory,
				reason: "copy-on-write failure cached",
			});
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
				outcomes.push({
					kind: "skipped",
					dir: entry.directory,
					reason: "destination already exists",
				});
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
			outcomes.push({
				kind: "skipped",
				dir: entry.directory,
				reason,
			});
			continue;
		}

		await failureStore.clear(options.repoRoot, entry.directory);
		let installSkipped = false;
		if (options.postProcessor) {
			try {
				const postProcess = await options.postProcessor.postProcess(
					entry.directory,
					entry.destination,
				);
				installSkipped = postProcess?.installSkipped ?? false;
				if (postProcess?.warning) {
					options.reporter.write(`syncDirs: ${postProcess.warning}\n`);
				}
			} catch (error) {
				options.reporter.write(
					`syncDirs: post-processing failed (${toErrorMessage(error)})\n`,
				);
			}
		}

		const clonedDirectory: ClonedDirectory = {
			bytes: result.bytes,
			dir: entry.directory,
			installSkipped,
			ms: result.ms,
		};
		const outcome = { kind: "cloned" as const, directory: clonedDirectory };
		outcomes.push(outcome);
		options.reporter.cloned(clonedDirectory);
	}

	return outcomes;
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
