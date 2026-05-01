import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { GLOBAL_CONFIG_DIRECTORY } from './config.js';

export const HISTORY_FILE_NAME = 'history.json';
const MAX_HISTORY_ENTRIES = 50;

export interface HistoryEntry {
  branch: string | null;
  path: string;
  timestamp: number;
}

export function HISTORY_FILE_PATH(home: string = homedir()): string {
  const configDir = process.env.GJI_CONFIG_DIR;
  if (configDir) {
    return join(resolve(configDir), HISTORY_FILE_NAME);
  }
  return join(home, GLOBAL_CONFIG_DIRECTORY, HISTORY_FILE_NAME);
}

export async function loadHistory(home: string = homedir()): Promise<HistoryEntry[]> {
  const path = HISTORY_FILE_PATH(home);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryEntry);
  } catch {
    return [];
  }
}

export async function appendHistory(
  path: string,
  branch: string | null,
  home: string = homedir(),
): Promise<void> {
  const historyPath = HISTORY_FILE_PATH(home);
  const existing = await loadHistory(home);

  // Skip if the most recent entry is the same path (no-op navigation)
  if (existing.length > 0 && existing[0].path === path) {
    return;
  }

  const entry: HistoryEntry = { branch, path, timestamp: Date.now() };
  const next = [entry, ...existing].slice(0, MAX_HISTORY_ENTRIES);

  await mkdir(dirname(historyPath), { recursive: true });
  await writeFile(historyPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof (value as { path: unknown }).path === 'string' &&
    'timestamp' in value &&
    typeof (value as { timestamp: unknown }).timestamp === 'number'
  );
}
