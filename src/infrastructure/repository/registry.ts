import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { RepoRegistryEntry } from "../../domain/repository/registry.js";
import { withFileLock, writeJsonAtomic } from "../filesystem/locked-file.js";
import { GLOBAL_CONFIG_DIRECTORY } from "../persistence/config.js";

const REGISTRY_FILE_NAME = "repos.json";
const MAX_REGISTRY_ENTRIES = 100;

export interface RegistryRemovalResult {
	removedPaths: string[];
	skippedPaths: string[];
}

export function REGISTRY_FILE_PATH(home: string = homedir()): string {
	const configDir = process.env.GJI_CONFIG_DIR;
	if (configDir) {
		return join(resolve(configDir), REGISTRY_FILE_NAME);
	}
	return join(home, GLOBAL_CONFIG_DIRECTORY, REGISTRY_FILE_NAME);
}

export async function loadRegistry(
	home: string = homedir(),
): Promise<RepoRegistryEntry[]> {
	const path = REGISTRY_FILE_PATH(home);
	try {
		const raw = await readFile(path, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isRegistryEntry);
	} catch {
		return [];
	}
}

async function canonicalizeRepoPath(repoPath: string): Promise<string> {
	try {
		return await realpath(repoPath);
	} catch {
		return resolve(repoPath);
	}
}

export async function registerRepo(
	repoPath: string,
	home: string = homedir(),
): Promise<void> {
	const registryPath = REGISTRY_FILE_PATH(home);
	const canonicalRepoPath = await canonicalizeRepoPath(repoPath);

	// Skip the lock and the write if this repo is already the most-recently-used entry (common case).
	if ((await loadRegistry(home))[0]?.path === canonicalRepoPath) return;

	await withFileLock(registryPath, async () => {
		const existing = await normalizeRegistryForWrite(await loadRegistry(home));
		if (existing.length > 0 && existing[0].path === canonicalRepoPath) return;

		const entry: RepoRegistryEntry = {
			lastUsed: Date.now(),
			name: basename(canonicalRepoPath),
			path: canonicalRepoPath,
		};

		const filtered = existing.filter((e) => e.path !== canonicalRepoPath);
		const next = [entry, ...filtered].slice(0, MAX_REGISTRY_ENTRIES);

		await writeJsonAtomic(registryPath, next);
	});
}

export async function removeMissingRegistryEntries(
	paths: ReadonlySet<string>,
	home: string = homedir(),
): Promise<RegistryRemovalResult> {
	if (paths.size === 0) return { removedPaths: [], skippedPaths: [] };

	const registryPath = REGISTRY_FILE_PATH(home);
	return withFileLock(registryPath, async () => {
		const entries = await loadRegistry(home);
		const candidates = entries.filter((entry) => paths.has(entry.path));
		const status = await Promise.all(
			candidates.map(async (entry) => ({
				entry,
				missing: await isMissingPath(entry.path),
			})),
		);
		const removedPaths = status
			.filter(({ missing }) => missing)
			.map(({ entry }) => entry.path);
		const skippedPaths = status
			.filter(({ missing }) => !missing)
			.map(({ entry }) => entry.path);

		if (removedPaths.length > 0) {
			await writeJsonAtomic(
				registryPath,
				entries.filter((entry) => !removedPaths.includes(entry.path)),
			);
		}

		return { removedPaths, skippedPaths };
	});
}

async function isMissingPath(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return false;
	} catch (error) {
		return isMissingPathError(error);
	}
}

function isMissingPathError(error: unknown): boolean {
	if (!(error instanceof Error) || !("code" in error)) return false;

	const code = (error as NodeJS.ErrnoException).code;
	return code === "ENOENT" || code === "ENOTDIR";
}

async function normalizeRegistryForWrite(
	entries: RepoRegistryEntry[],
): Promise<RepoRegistryEntry[]> {
	const normalized: RepoRegistryEntry[] = [];
	const seenPaths = new Set<string>();

	for (const entry of entries) {
		const canonicalPath = await canonicalizeRepoPath(entry.path);
		if (seenPaths.has(canonicalPath)) {
			continue;
		}

		seenPaths.add(canonicalPath);
		normalized.push({
			...entry,
			name: basename(canonicalPath),
			path: canonicalPath,
		});
	}

	return normalized;
}

function isRegistryEntry(value: unknown): value is RepoRegistryEntry {
	return (
		typeof value === "object" &&
		value !== null &&
		"path" in value &&
		typeof (value as { path: unknown }).path === "string" &&
		"name" in value &&
		typeof (value as { name: unknown }).name === "string" &&
		"lastUsed" in value &&
		typeof (value as { lastUsed: unknown }).lastUsed === "number"
	);
}
