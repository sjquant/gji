import { homedir } from "node:os";
import { join } from "node:path";

import {
	type GjiConfig,
	loadGlobalConfig,
	saveGlobalConfig,
} from "./config.js";
import { validateSyncFilePattern } from "./file-sync.js";
import { detectRepository } from "./repo.js";

export interface SyncFilesCommandOptions {
	action?: string;
	cwd: string;
	home?: string;
	json?: boolean;
	paths?: string[];
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export async function runSyncFilesCommand(
	options: SyncFilesCommandOptions,
): Promise<number> {
	const repository = await detectRepository(options.cwd);
	const home = options.home ?? homedir();
	const loaded = await loadGlobalConfig(home);
	const repoEntry = findRepoConfigEntry(
		loaded.config,
		repository.repoRoot,
		home,
	);
	const repoConfig = repoEntry?.config ?? {};

	switch (options.action) {
		case undefined:
		case "list": {
			writeSyncFiles(options.stdout, readSyncFiles(repoConfig), !!options.json);
			return 0;
		}
		case "add": {
			const paths = validatePaths(options.paths ?? [], options);
			if (!paths) return 1;

			const nextFiles = mergeSyncFiles(readSyncFiles(repoConfig), paths);
			await saveRepoSyncFiles(
				loaded.config,
				repoEntry?.key ?? repository.repoRoot,
				nextFiles,
				home,
			);
			writeSyncFiles(options.stdout, nextFiles, !!options.json);
			return 0;
		}
		case "remove": {
			const paths = validatePaths(options.paths ?? [], options);
			if (!paths) return 1;

			const existingFiles = readSyncFiles(repoConfig);
			const nextFiles = removeSyncFiles(existingFiles, paths);
			if (repoEntry && nextFiles.length !== existingFiles.length) {
				await saveRepoSyncFiles(loaded.config, repoEntry.key, nextFiles, home);
			}
			writeSyncFiles(options.stdout, nextFiles, !!options.json);
			return 0;
		}
	}

	writeError(options, `unknown action: ${options.action}`);
	return 1;
}

interface RepoConfigEntry {
	config: Record<string, unknown>;
	key: string;
}

function findRepoConfigEntry(
	config: GjiConfig,
	repoRoot: string,
	home: string,
): RepoConfigEntry | null {
	const repos = config.repos;
	if (!isPlainObject(repos)) return null;

	for (const [key, value] of Object.entries(repos)) {
		if (expandTilde(key, home) === repoRoot && isPlainObject(value)) {
			return { config: value, key };
		}
	}

	return null;
}

function readSyncFiles(config: Record<string, unknown>): string[] {
	const syncFiles = config.syncFiles;
	if (!Array.isArray(syncFiles)) return [];

	return syncFiles.filter((item): item is string => typeof item === "string");
}

function writeSyncFiles(
	stdout: (chunk: string) => void,
	files: string[],
	json: boolean,
): void {
	if (json) {
		stdout(`${JSON.stringify(files, null, 2)}\n`);
		return;
	}

	if (files.length === 0) {
		stdout("No sync files configured for this repo.\n");
		return;
	}

	stdout(`${files.join("\n")}\n`);
}

function validatePaths(
	paths: string[],
	options: Pick<SyncFilesCommandOptions, "json" | "stderr">,
): string[] | null {
	if (paths.length === 0) {
		writeError(options, "at least one path is required");
		return null;
	}

	const validatedPaths: string[] = [];
	for (const path of paths) {
		try {
			validatedPaths.push(validateSyncFilePattern(path));
		} catch (error) {
			writeError(
				options,
				error instanceof Error ? error.message : String(error),
			);
			return null;
		}
	}

	return validatedPaths;
}

function mergeSyncFiles(existing: string[], additions: string[]): string[] {
	const nextFiles = [...existing];
	for (const path of additions) {
		if (!nextFiles.includes(path)) {
			nextFiles.push(path);
		}
	}

	return nextFiles;
}

function removeSyncFiles(existing: string[], removals: string[]): string[] {
	const removalSet = new Set(removals);

	return existing.filter((path) => !removalSet.has(path));
}

async function saveRepoSyncFiles(
	config: GjiConfig,
	repoKey: string,
	syncFiles: string[],
	home: string,
): Promise<void> {
	const repos = isPlainObject(config.repos) ? { ...config.repos } : {};
	const repoConfig = isPlainObject(repos[repoKey])
		? (repos[repoKey] as Record<string, unknown>)
		: {};
	const nextRepoConfig = { ...repoConfig };
	if (syncFiles.length > 0) {
		nextRepoConfig.syncFiles = syncFiles;
	} else {
		delete nextRepoConfig.syncFiles;
	}

	if (Object.keys(nextRepoConfig).length > 0) {
		repos[repoKey] = nextRepoConfig;
	} else {
		delete repos[repoKey];
	}

	await saveGlobalConfig({ ...config, repos }, home);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeError(
	options: Pick<SyncFilesCommandOptions, "json" | "stderr">,
	message: string,
): void {
	if (options.json) {
		options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
		return;
	}

	options.stderr(`gji sync-files: ${message}\n`);
}

function expandTilde(value: string, home: string): string {
	if (value === "~") return home;
	if (value.startsWith("~/")) return join(home, value.slice(2));

	return value;
}
