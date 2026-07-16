import {
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

export interface RepoRegistryEntry {
	lastUsed: number;
	name: string;
	path: string;
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
}

export async function removeRegistryEntries(
	paths: ReadonlySet<string>,
	home: string = homedir(),
): Promise<string[]> {
	if (paths.size === 0) return [];

	const registryPath = REGISTRY_FILE_PATH(home);
	const entries = await loadRegistry(home);
	const removedPaths = entries
		.filter((entry) => paths.has(entry.path))
		.map((entry) => entry.path);

	if (removedPaths.length === 0) return [];

	await writeRegistry(
		entries.filter((entry) => !paths.has(entry.path)),
		registryPath,
	);
	return removedPaths;
}

async function writeRegistry(
	entries: RepoRegistryEntry[],
	registryPath: string,
): Promise<void> {
	await mkdir(dirname(registryPath), { recursive: true });
	const temporaryPath = `${registryPath}.tmp-${process.pid}-${Date.now()}`;

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
