import { randomUUID } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { GLOBAL_CONFIG_DIRECTORY } from "./config.js";

const STATE_FILE_NAME = "state.json";
const CLONE_FAILURE_TTL_MS = 24 * 60 * 60 * 1000;

interface CloneFailure {
	failedAt: number;
	reason: string;
}

interface CloneFailureState {
	syncDirs?: Record<string, Record<string, CloneFailure>>;
	[key: string]: unknown;
}

export interface CloneFailureStore {
	isCached(repoRoot: string, directory: string): Promise<boolean>;
	cache(repoRoot: string, directory: string, reason: string): Promise<void>;
	clear(repoRoot: string, directory: string): Promise<void>;
}

export class FileCloneFailureStore implements CloneFailureStore {
	private updateQueue = Promise.resolve();

	async isCached(repoRoot: string, directory: string): Promise<boolean> {
		const state = await this.readState();
		const repoState = state.syncDirs?.[repoRoot];
		if (!repoState || !Object.hasOwn(repoState, directory)) return false;

		const failure = repoState[directory];
		return (
			isPlainObject(failure) &&
			typeof failure.failedAt === "number" &&
			Date.now() - failure.failedAt < CLONE_FAILURE_TTL_MS
		);
	}

	async cache(
		repoRoot: string,
		directory: string,
		reason: string,
	): Promise<void> {
		await this.update(async () => {
			const state = await this.readState();
			const syncDirs = state.syncDirs ?? {};
			const repoState = syncDirs[repoRoot] ?? {};

			syncDirs[repoRoot] = {
				...repoState,
				[directory]: { failedAt: Date.now(), reason },
			};

			await this.writeState({ ...state, syncDirs });
		});
	}

	async clear(repoRoot: string, directory: string): Promise<void> {
		await this.update(async () => {
			const state = await this.readState();
			const repoState = state.syncDirs?.[repoRoot];
			if (!repoState || !Object.hasOwn(repoState, directory)) return;

			const nextRepoState = { ...repoState };
			delete nextRepoState[directory];
			const syncDirs = { ...state.syncDirs };
			if (Object.keys(nextRepoState).length === 0) delete syncDirs[repoRoot];
			else syncDirs[repoRoot] = nextRepoState;

			await this.writeState({ ...state, syncDirs });
		});
	}

	private async update(operation: () => Promise<void>): Promise<void> {
		const next = this.updateQueue.then(operation, operation);
		this.updateQueue = next.then(
			() => undefined,
			() => undefined,
		);
		await next;
	}

	private async readState(): Promise<CloneFailureState> {
		try {
			const raw = await readFile(this.stateFilePath(), "utf8");
			const parsed = JSON.parse(raw) as unknown;
			if (!isPlainObject(parsed)) return {};
			return isPlainObject(parsed.syncDirs)
				? (parsed as CloneFailureState)
				: { ...parsed, syncDirs: {} };
		} catch {
			return {};
		}
	}

	private async writeState(state: CloneFailureState): Promise<void> {
		try {
			const path = this.stateFilePath();
			const directory = dirname(path);
			await mkdir(directory, { recursive: true });
			const temporaryDirectory = await mkdtemp(
				join(directory, `.gji-state-${randomUUID()}-`),
			);
			const temporaryPath = join(temporaryDirectory, STATE_FILE_NAME);
			try {
				await writeFile(
					temporaryPath,
					`${JSON.stringify(state, null, 2)}\n`,
					"utf8",
				);
				await rename(temporaryPath, path);
			} finally {
				await rm(temporaryDirectory, { force: true, recursive: true });
			}
		} catch {
			// The cache is advisory and must never block worktree creation.
		}
	}

	private stateFilePath(home: string = homedir()): string {
		const configuredDirectory = process.env.GJI_CONFIG_DIR;
		const directory = configuredDirectory
			? resolve(configuredDirectory)
			: join(home, GLOBAL_CONFIG_DIRECTORY);

		return join(directory, STATE_FILE_NAME);
	}
}

export const defaultCloneFailureStore: CloneFailureStore =
	new FileCloneFailureStore();

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
