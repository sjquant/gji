import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { GLOBAL_CONFIG_DIRECTORY } from './config.js';

const REGISTRY_FILE_NAME = 'repos.json';
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

export async function loadRegistry(home: string = homedir()): Promise<RepoRegistryEntry[]> {
  const path = REGISTRY_FILE_PATH(home);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRegistryEntry);
  } catch {
    return [];
  }
}

export async function registerRepo(repoPath: string, home: string = homedir()): Promise<void> {
  const registryPath = REGISTRY_FILE_PATH(home);
  const existing = await loadRegistry(home);

  // Skip write if this repo is already the most-recently-used entry (common case).
  if (existing.length > 0 && existing[0].path === repoPath) return;

  const entry: RepoRegistryEntry = {
    lastUsed: Date.now(),
    name: basename(repoPath),
    path: repoPath,
  };

  const filtered = existing.filter((e) => e.path !== repoPath);
  const next = [entry, ...filtered].slice(0, MAX_REGISTRY_ENTRIES);

  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function isRegistryEntry(value: unknown): value is RepoRegistryEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof (value as { path: unknown }).path === 'string' &&
    'name' in value &&
    typeof (value as { name: unknown }).name === 'string' &&
    'lastUsed' in value &&
    typeof (value as { lastUsed: unknown }).lastUsed === 'number'
  );
}
