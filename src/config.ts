import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const CONFIG_FILE_NAME = '.gji.json';
export const GLOBAL_CONFIG_DIRECTORY = '.config/gji';
export const GLOBAL_CONFIG_NAME = 'config.json';

export const KNOWN_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'branchPrefix',
  'editor',
  'hooks',
  'installSaveTarget',
  'shellIntegration',
  'skipInstallPrompt',
  'syncDefaultBranch',
  'syncFiles',
  'syncRemote',
  'worktreePath',
]);

const KNOWN_GLOBAL_CONFIG_KEYS: ReadonlySet<string> = new Set([
  ...KNOWN_CONFIG_KEYS,
  'repos',
]);

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

export async function loadEffectiveConfig(
  root: string,
  home: string = homedir(),
  onWarning?: (message: string) => void,
): Promise<GjiConfig> {
  const [globalConfig, localConfig] = await Promise.all([
    loadGlobalConfig(home),
    loadConfig(root),
  ]);

  // Extract per-repo override keyed by the absolute repo path.
  // Keys may use ~ as shorthand for the home directory (e.g. ~/code/my-repo).
  const repos = globalConfig.config.repos;
  const perRepoConfig: Record<string, unknown> = isPlainObject(repos)
    ? findPerRepoConfig(repos, root, home)
    : {};

  // Strip the internal `repos` registry from the global base before merging.
  const globalBase: Record<string, unknown> = { ...globalConfig.config };
  delete globalBase.repos;

  if (onWarning) {
    if (globalConfig.exists) {
      warnUnknownKeys(globalBase, globalConfig.path, KNOWN_GLOBAL_CONFIG_KEYS, onWarning);
      if (Object.keys(perRepoConfig).length > 0) {
        warnUnknownKeys(perRepoConfig, globalConfig.path, KNOWN_CONFIG_KEYS, onWarning);
      }
    }
    if (localConfig.exists) {
      warnUnknownKeys(localConfig.config, localConfig.path, KNOWN_CONFIG_KEYS, onWarning);
    }
  }

  // Precedence (lowest → highest): global base → per-repo global → local.
  const merged = mergeConfig(globalBase, perRepoConfig, localConfig.config);

  // Warn about relative worktreePath: it must be absolute or tilde-prefixed.
  const worktreePathValue = merged.worktreePath;
  if (
    onWarning &&
    typeof worktreePathValue === 'string' &&
    worktreePathValue.length > 0 &&
    !worktreePathValue.startsWith('/') &&
    !worktreePathValue.startsWith('~')
  ) {
    onWarning(
      `gji: "worktreePath" must be an absolute path or start with ~, got "${worktreePathValue}" — using default\n`,
    );
  }

  // Hooks are spread across all three layers so that different hook keys from
  // different layers both apply (e.g. global afterEnter + local afterCreate).
  // Within each key the higher-precedence layer wins (same spread order).
  const globalHooks = isPlainObject(globalBase.hooks) ? globalBase.hooks : {};
  const perRepoHooks = isPlainObject(perRepoConfig.hooks) ? perRepoConfig.hooks : {};
  const localHooks = isPlainObject(localConfig.config.hooks) ? localConfig.config.hooks : {};

  if (
    Object.keys(globalHooks).length > 0 ||
    Object.keys(perRepoHooks).length > 0 ||
    Object.keys(localHooks).length > 0
  ) {
    merged.hooks = { ...globalHooks, ...perRepoHooks, ...localHooks };
  }

  return merged;
}

export async function loadGlobalConfig(home: string = homedir()): Promise<LoadedConfig> {
  return loadConfigFile(GLOBAL_CONFIG_FILE_PATH(home));
}

export async function saveLocalConfig(root: string, config: GjiConfig): Promise<string> {
  const path = join(root, CONFIG_FILE_NAME);

  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  return path;
}

export async function updateLocalConfigKey(
  root: string,
  key: string,
  value: unknown,
): Promise<GjiConfig> {
  const loaded = await loadConfig(root);
  const nextConfig = {
    ...loaded.config,
    [key]: value,
  };

  await saveLocalConfig(root, nextConfig);

  return nextConfig;
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

export async function updateGlobalRepoConfigKey(
  repoRoot: string,
  key: string,
  value: unknown,
  home: string = homedir(),
): Promise<GjiConfig> {
  const loaded = await loadGlobalConfig(home);
  const repos = isPlainObject(loaded.config.repos) ? { ...loaded.config.repos } : {};
  const existing = isPlainObject(repos[repoRoot]) ? repos[repoRoot] as Record<string, unknown> : {};

  repos[repoRoot] = { ...existing, [key]: value };

  const nextConfig = { ...loaded.config, repos };

  await saveGlobalConfig(nextConfig, home);

  return nextConfig;
}

export function GLOBAL_CONFIG_FILE_PATH(home: string = homedir()): string {
  const configDir = process.env.GJI_CONFIG_DIR;
  if (configDir) {
    return join(resolve(configDir), GLOBAL_CONFIG_NAME);
  }
  return join(home, GLOBAL_CONFIG_DIRECTORY, GLOBAL_CONFIG_NAME);
}

export function parseConfigValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function resolveConfigString(config: GjiConfig, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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

function mergeConfig(...values: Record<string, unknown>[]): GjiConfig {
  return values.reduce<GjiConfig>(
    (config, value) => ({
      ...config,
      ...value,
    }),
    { ...DEFAULT_CONFIG },
  );
}

function findPerRepoConfig(
  repos: Record<string, unknown>,
  repoRoot: string,
  home: string,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(repos)) {
    const expandedKey = expandTilde(key, home);
    if (expandedKey === repoRoot && isPlainObject(value)) {
      return value as Record<string, unknown>;
    }
  }

  return {};
}

function expandTilde(value: string, home: string): string {
  if (value === '~') return home;
  if (value.startsWith('~/')) return join(home, value.slice(2));

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function warnUnknownKeys(
  config: Record<string, unknown>,
  filePath: string,
  knownKeys: ReadonlySet<string>,
  onWarning: (message: string) => void,
): void {
  for (const key of Object.keys(config)) {
    if (!knownKeys.has(key)) {
      const suggestion = closestKey(key, knownKeys);
      const hint = suggestion ? ` (did you mean "${suggestion}"?)` : '';
      onWarning(`gji: unknown config key "${key}" in ${filePath}${hint}\n`);
    }
  }
}

function closestKey(unknown: string, knownKeys: ReadonlySet<string>): string | null {
  let best: string | null = null;
  let bestDist = Infinity;

  for (const key of knownKeys) {
    const dist = levenshtein(unknown, key);
    if (dist < bestDist) {
      bestDist = dist;
      best = key;
    }
  }

  return bestDist <= Math.max(2, Math.floor(unknown.length / 2)) ? best : null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}
