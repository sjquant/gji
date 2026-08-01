import type {
	CloneDirectory,
	CloneDirResult,
	CloneRequestOptions,
} from "./dir-clone.js";
import {
	isCloneDestinationExistsError,
	isCloneInProgressError,
} from "./dir-clone.js";
import { inspectDestination } from "./safe-destination.js";
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
	readonly measureCloneSize: boolean;
	write(message: string): void;
	cloned(directory: ClonedDirectory): void;
	skipped?(directory: { dir: string; reason: string }): void;
}

export interface SyncDirectoryExecutionOptions {
	cloneDirectory: CloneDirectory;
	reporter: SyncDirectoryReporter;
}

export async function executeSyncDirectoryPlan(
	plan: readonly SyncDirectoryPlan[],
	options: SyncDirectoryExecutionOptions,
): Promise<SyncDirectoryOutcome[]> {
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

		const destinationState = await inspectDestination(
			entry.worktreePath,
			entry.destination,
		);
		if (destinationState.kind === "exists") {
			recordSkipped(
				outcomes,
				options.reporter,
				entry.directory,
				"destination already exists",
			);
			continue;
		}
		if (destinationState.kind === "unsafe") {
			const reason = destinationState.reason;
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

		const refreshedDestinationState = await inspectDestination(
			entry.worktreePath,
			entry.destination,
		);
		if (refreshedDestinationState.kind !== "missing") {
			recordSkipped(
				outcomes,
				options.reporter,
				entry.directory,
				refreshedDestinationState.kind === "unsafe"
					? refreshedDestinationState.reason
					: "destination already exists",
			);
			continue;
		}

		let result: CloneDirResult;
		try {
			const cloneOptions: CloneRequestOptions = {
				destinationRoot: entry.worktreePath,
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
				recordSkipped(outcomes, options.reporter, entry.directory, reason);
				continue;
			}

			const reason = toErrorMessage(error);
			recordSkipped(outcomes, options.reporter, entry.directory, reason);
			continue;
		}

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
): void {
	outcomes.push({ kind: "skipped", dir, reason });
	if (reporter.skipped) reporter.skipped({ dir, reason });
	else reporter.write(`syncDirs: ${reason}, skipped ${dir}\n`);
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
