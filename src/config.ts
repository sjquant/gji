import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CONFIG_FILE_NAME = '.gji.json';

export type GjiConfig = Record<string, unknown>;

export interface LoadedConfig {
  config: GjiConfig;
  exists: boolean;
  path: string;
}

export const DEFAULT_CONFIG: GjiConfig = Object.freeze({});

export async function loadConfig(root: string): Promise<LoadedConfig> {
  const path = join(root, CONFIG_FILE_NAME);

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
