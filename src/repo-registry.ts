import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { GLOBAL_CONFIG_DIRECTORY } from "./config.js";

const REGISTRY_FILE_NAME = "repos.json";
const MAX_REGISTRY_ENTRIES = 100;
const registryLocks = new Map<string, Promise<void>>();

export interface RepoRegistryEntry {
	lastUsed: number;
	name: string;
	path: string;
}

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
	await withRegistryLock(registryPath, async () => {
		const existing = await normalizeRegistryForWrite(await loadRegistry(home));
		const canonicalRepoPath = await canonicalizeRepoPath(repoPath);

		// Skip write if this repo is already the most-recently-used entry (common case).
		if (existing.length > 0 && existing[0].path === canonicalRepoPath) return;

		const entry: RepoRegistryEntry = {
			lastUsed: Date.now(),
			name: basename(canonicalRepoPath),
			path: canonicalRepoPath,
		};

		const filtered = existing.filter((e) => e.path !== canonicalRepoPath);
		const next = [entry, ...filtered].slice(0, MAX_REGISTRY_ENTRIES);

		await writeRegistry(next, registryPath);
	});
}

export async function removeMissingRegistryEntries(
	paths: ReadonlySet<string>,
	home: string = homedir(),
): Promise<RegistryRemovalResult> {
	if (paths.size === 0) return { removedPaths: [], skippedPaths: [] };

	const registryPath = REGISTRY_FILE_PATH(home);
	return withRegistryLock(registryPath, async () => {
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
			await writeRegistry(
				entries.filter((entry) => !removedPaths.includes(entry.path)),
				registryPath,
			);
		}

		return { removedPaths, skippedPaths };
	});
}

async function withRegistryLock<T>(
	registryPath: string,
	operation: () => Promise<T>,
): Promise<T> {
	const previous = registryLocks.get(registryPath);
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	registryLocks.set(registryPath, current);

	if (previous) await previous;

	try {
		return await operation();
	} finally {
		release();
		if (registryLocks.get(registryPath) === current) {
			registryLocks.delete(registryPath);
		}
	}
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

async function writeRegistry(
	entries: RepoRegistryEntry[],
	registryPath: string,
): Promise<void> {
	await mkdir(dirname(registryPath), { recursive: true });
	const temporaryPath = `${registryPath}.tmp-${process.pid}-${randomUUID()}`;

	try {
		await writeFile(
			temporaryPath,
			`${JSON.stringify(entries, null, 2)}\n`,
			"utf8",
		);
		await rename(temporaryPath, registryPath);
	} catch (error) {
		await rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
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
