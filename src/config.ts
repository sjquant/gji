import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const CONFIG_FILE_NAME = '.gji.json';
export const GLOBAL_CONFIG_DIRECTORY = '.config/gji';
export const GLOBAL_CONFIG_NAME = 'config.json';

export type GjiConfig = Record<string, unknown>;

export interface LoadedConfig {
  config: GjiConfig;
  exists: boolean;
  path: string;
}

export const DEFAULT_CONFIG: GjiConfig = Object.freeze({});

export async function loadConfig(root: string): Promise<LoadedConfig> {
  const path = join(root, CONFIG_FILE_NAME);

  return loadConfigFile(path);
}

export async function loadGlobalConfig(home: string = homedir()): Promise<LoadedConfig> {
  return loadConfigFile(GLOBAL_CONFIG_FILE_PATH(home));
}

export async function saveGlobalConfig(
  config: GjiConfig,
  home: string = homedir(),
): Promise<string> {
  const path = GLOBAL_CONFIG_FILE_PATH(home);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  return path;
}

export async function unsetGlobalConfigKey(
  key: string,
  home: string = homedir(),
): Promise<GjiConfig> {
  const loaded = await loadGlobalConfig(home);
  const nextConfig = { ...loaded.config };

  delete nextConfig[key];
  await saveGlobalConfig(nextConfig, home);

  return nextConfig;
}

export async function updateGlobalConfigKey(
  key: string,
  value: unknown,
  home: string = homedir(),
): Promise<GjiConfig> {
  const loaded = await loadGlobalConfig(home);
  const nextConfig = {
    ...loaded.config,
    [key]: value,
  };

  await saveGlobalConfig(nextConfig, home);

  return nextConfig;
}

export function GLOBAL_CONFIG_FILE_PATH(home: string = homedir()): string {
  return join(home, GLOBAL_CONFIG_DIRECTORY, GLOBAL_CONFIG_NAME);
}

export function parseConfigValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

async function loadConfigFile(path: string): Promise<LoadedConfig> {
  try {
    const rawConfig = await readFile(path, 'utf8');
    const parsedConfig = JSON.parse(rawConfig) as Record<string, unknown>;

    return {
      config: mergeConfig(parsedConfig),
      exists: true,
      path,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
      config: DEFAULT_CONFIG,
      exists: false,
      path,
    };
    }

    throw error;
  }
}

function mergeConfig(value: Record<string, unknown>): GjiConfig {
  return {
    ...DEFAULT_CONFIG,
    ...value,
  };
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
