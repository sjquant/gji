import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CONFIG_FILE_NAME,
  DEFAULT_CONFIG,
  GLOBAL_CONFIG_FILE_PATH,
  KNOWN_CONFIG_KEYS,
  loadConfig,
  resolveConfigString,
  loadEffectiveConfig,
  saveLocalConfig,
  updateGlobalRepoConfigKey,
  updateLocalConfigKey,
} from './config.js';

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
    return;
  }
  process.env.HOME = originalHome;
});

describe('resolveConfigString', () => {
  it('returns the string value when the key exists and is non-empty', () => {
    expect(resolveConfigString({ branchPrefix: 'feat/' }, 'branchPrefix')).toBe('feat/');
  });

  it('returns undefined for a missing key', () => {
    expect(resolveConfigString({}, 'branchPrefix')).toBeUndefined();
  });

  it('returns undefined for an empty string value', () => {
    expect(resolveConfigString({ branchPrefix: '' }, 'branchPrefix')).toBeUndefined();
  });

  it('returns undefined for a non-string value', () => {
    expect(resolveConfigString({ branchPrefix: 42 }, 'branchPrefix')).toBeUndefined();
  });
});

describe('loadConfig', () => {
  it('returns defaults when the config file does not exist', async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));

    // When
    const result = await loadConfig(root);

    // Then
    expect(result).toEqual({
      config: DEFAULT_CONFIG,
      exists: false,
      path: join(root, CONFIG_FILE_NAME),
    });
  });

  it('merges a project config file with the defaults', async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));
    await writeFile(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({ branchPrefix: 'feature/' }),
      'utf8',
    );

    // When
    const result = await loadConfig(root);

    // Then
    expect(result).toEqual({
      config: {
        ...DEFAULT_CONFIG,
        branchPrefix: 'feature/',
      },
      exists: true,
      path: join(root, CONFIG_FILE_NAME),
    });
  });
});

describe('saveLocalConfig', () => {
  it('creates the config file and returns its path when it does not exist', async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));
    const config = { branchPrefix: 'feat/' };

    // When
    const savedPath = await saveLocalConfig(root, config);

    // Then
    expect(savedPath).toBe(join(root, CONFIG_FILE_NAME));
    const written = JSON.parse(await readFile(savedPath, 'utf8')) as unknown;
    expect(written).toEqual(config);
  });

  it('overwrites an existing config file', async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));
    const configPath = join(root, CONFIG_FILE_NAME);
    await writeFile(configPath, JSON.stringify({ branchPrefix: 'old/' }), 'utf8');

    // When
    await saveLocalConfig(root, { branchPrefix: 'new/' });

    // Then
    const written = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    expect(written).toEqual({ branchPrefix: 'new/' });
  });
});

describe('updateLocalConfigKey', () => {
  it('creates the config file with the key when it does not exist', async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));

    // When
    const result = await updateLocalConfigKey(root, 'branchPrefix', 'feat/');

    // Then
    expect(result).toEqual({ branchPrefix: 'feat/' });
    const written = JSON.parse(
      await readFile(join(root, CONFIG_FILE_NAME), 'utf8'),
    ) as unknown;
    expect(written).toEqual({ branchPrefix: 'feat/' });
  });

  it('updates an existing key without losing other keys', async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));
    await writeFile(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({ branchPrefix: 'old/', syncRemote: 'origin' }),
      'utf8',
    );

    // When
    const result = await updateLocalConfigKey(root, 'branchPrefix', 'new/');

    // Then
    expect(result).toEqual({ branchPrefix: 'new/', syncRemote: 'origin' });
  });

  it('adds a new key while preserving existing keys', async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));
    await writeFile(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({ branchPrefix: 'feat/' }),
      'utf8',
    );

    // When
    const result = await updateLocalConfigKey(root, 'syncRemote', 'upstream');

    // Then
    expect(result).toEqual({ branchPrefix: 'feat/', syncRemote: 'upstream' });
  });
});

describe('loadEffectiveConfig – per-repo global config', () => {
  it('applies per-repo global config when the repo path matches', async () => {
    // Given a global config that has a repos entry keyed by the repo root.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'gji-repo-'));
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    process.env.HOME = home;

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        branchPrefix: 'global/',
        repos: {
          [repoRoot]: { branchPrefix: 'repo/' },
        },
      }),
      'utf8',
    );

    // When loadEffectiveConfig is called for that repo root.
    const config = await loadEffectiveConfig(repoRoot, home);

    // Then the per-repo branchPrefix overrides the global one.
    expect(config.branchPrefix).toBe('repo/');
  });

  it('ignores per-repo global config when no path matches', async () => {
    // Given a global config whose repos entry does not match the current repo root.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'gji-repo-'));
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    process.env.HOME = home;

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        branchPrefix: 'global/',
        repos: {
          '/some/other/repo': { branchPrefix: 'other/' },
        },
      }),
      'utf8',
    );

    // When loadEffectiveConfig is called for a different repo root.
    const config = await loadEffectiveConfig(repoRoot, home);

    // Then the global base branchPrefix is used unchanged.
    expect(config.branchPrefix).toBe('global/');
  });

  it('local config still takes highest precedence over per-repo global config', async () => {
    // Given global config with per-repo override and a local .gji.json.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'gji-repo-'));
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    process.env.HOME = home;

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        branchPrefix: 'global/',
        repos: {
          [repoRoot]: { branchPrefix: 'per-repo/' },
        },
      }),
      'utf8',
    );
    await writeFile(
      join(repoRoot, CONFIG_FILE_NAME),
      JSON.stringify({ branchPrefix: 'local/' }),
      'utf8',
    );

    // When loadEffectiveConfig merges all three layers.
    const config = await loadEffectiveConfig(repoRoot, home);

    // Then the local config wins.
    expect(config.branchPrefix).toBe('local/');
  });

  it('per-repo global hooks override global base hooks for the same key', async () => {
    // Given a global config with a base afterCreate hook and a per-repo afterCreate hook.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'gji-repo-'));
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    process.env.HOME = home;

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        hooks: { afterCreate: 'echo global' },
        repos: {
          [repoRoot]: { hooks: { afterCreate: 'echo per-repo' } },
        },
      }),
      'utf8',
    );

    // When loadEffectiveConfig resolves hooks.
    const config = await loadEffectiveConfig(repoRoot, home);

    // Then the per-repo hook wins for that key.
    expect((config.hooks as Record<string, string>).afterCreate).toBe('echo per-repo');
  });

  it('per-repo global hooks combine with global base hooks for different keys', async () => {
    // Given global base has afterEnter and per-repo has afterCreate.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'gji-repo-'));
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    process.env.HOME = home;

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        hooks: { afterEnter: 'echo enter' },
        repos: {
          [repoRoot]: { hooks: { afterCreate: 'echo create' } },
        },
      }),
      'utf8',
    );

    // When loadEffectiveConfig resolves hooks.
    const config = await loadEffectiveConfig(repoRoot, home);

    // Then both hooks are present in the effective config.
    expect((config.hooks as Record<string, string>).afterEnter).toBe('echo enter');
    expect((config.hooks as Record<string, string>).afterCreate).toBe('echo create');
  });

  it('local hooks override per-repo global hooks for the same key', async () => {
    // Given per-repo global and local configs both define afterCreate.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'gji-repo-'));
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    process.env.HOME = home;

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        repos: {
          [repoRoot]: { hooks: { afterCreate: 'echo per-repo' } },
        },
      }),
      'utf8',
    );
    await writeFile(
      join(repoRoot, CONFIG_FILE_NAME),
      JSON.stringify({ hooks: { afterCreate: 'echo local' } }),
      'utf8',
    );

    // When loadEffectiveConfig resolves hooks.
    const config = await loadEffectiveConfig(repoRoot, home);

    // Then the local hook wins.
    expect((config.hooks as Record<string, string>).afterCreate).toBe('echo local');
  });

  it('does not expose the repos key in the effective config', async () => {
    // Given a global config with a repos section.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'gji-repo-'));
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    process.env.HOME = home;

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        repos: { [repoRoot]: { branchPrefix: 'x/' } },
      }),
      'utf8',
    );

    // When loadEffectiveConfig merges configs.
    const config = await loadEffectiveConfig(repoRoot, home);

    // Then the repos key is not present in the effective config.
    expect('repos' in config).toBe(false);
  });

  it('matches a tilde-prefixed repo key against the absolute repo path', async () => {
    // Given a global config where the repo is keyed with ~/… instead of an absolute path.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = join(home, 'code', 'my-repo');
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    process.env.HOME = home;

    await mkdir(repoRoot, { recursive: true });
    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({ repos: { '~/code/my-repo': { branchPrefix: 'tilde/' } } }),
      'utf8',
    );

    // When loadEffectiveConfig is called with the absolute repo path.
    const config = await loadEffectiveConfig(repoRoot, home);

    // Then the tilde-prefixed entry matches and its config is applied.
    expect(config.branchPrefix).toBe('tilde/');
  });

  it('ignores per-repo entry that is not a plain object (string, array, number)', async () => {
    // Given a global config where repos[root] is not an object.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'gji-repo-'));
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    process.env.HOME = home;

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        branchPrefix: 'global/',
        repos: {
          [repoRoot]: 'not-an-object',
        },
      }),
      'utf8',
    );

    // When loadEffectiveConfig is called.
    const config = await loadEffectiveConfig(repoRoot, home);

    // Then it falls back to the global base and does not throw.
    expect(config.branchPrefix).toBe('global/');
  });
});

describe('updateGlobalRepoConfigKey', () => {
  it('creates a repos entry when the global config has no repos section', async () => {
    // Given a global config with no repos section.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = '/home/me/code/my-repo';
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(globalConfigPath, JSON.stringify({ branchPrefix: 'feat/' }), 'utf8');

    // When a repo-scoped key is updated.
    await updateGlobalRepoConfigKey(repoRoot, 'branchPrefix', 'fix/', home);

    // Then the global config has a repos entry for that path.
    const written = JSON.parse(await readFile(globalConfigPath, 'utf8')) as Record<string, unknown>;
    const repos = written.repos as Record<string, unknown>;
    expect((repos[repoRoot] as Record<string, unknown>).branchPrefix).toBe('fix/');
    // And the top-level key is untouched.
    expect(written.branchPrefix).toBe('feat/');
  });

  it('adds to an existing repos section without overwriting other repos', async () => {
    // Given a global config that already has a repos entry for a different repo.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const otherRepo = '/other/repo';
    const repoRoot = '/my/repo';
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({ repos: { [otherRepo]: { branchPrefix: 'other/' } } }),
      'utf8',
    );

    // When a key is updated for a different repo.
    await updateGlobalRepoConfigKey(repoRoot, 'branchPrefix', 'mine/', home);

    // Then both repos are present.
    const written = JSON.parse(await readFile(globalConfigPath, 'utf8')) as Record<string, unknown>;
    const repos = written.repos as Record<string, unknown>;
    expect((repos[otherRepo] as Record<string, unknown>).branchPrefix).toBe('other/');
    expect((repos[repoRoot] as Record<string, unknown>).branchPrefix).toBe('mine/');
  });

  it('preserves other keys in an existing repo entry', async () => {
    // Given a global config with a per-repo entry that already has a hooks key.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = '/my/repo';
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({ repos: { [repoRoot]: { hooks: { afterCreate: 'npm install' } } } }),
      'utf8',
    );

    // When a different key is written for the same repo.
    await updateGlobalRepoConfigKey(repoRoot, 'branchPrefix', 'feat/', home);

    // Then both keys exist in the repo entry.
    const written = JSON.parse(await readFile(globalConfigPath, 'utf8')) as Record<string, unknown>;
    const entry = (written.repos as Record<string, unknown>)[repoRoot] as Record<string, unknown>;
    expect(entry.branchPrefix).toBe('feat/');
    expect((entry.hooks as Record<string, unknown>).afterCreate).toBe('npm install');
  });
});

describe('KNOWN_CONFIG_KEYS', () => {
  it('includes the keys used by commands', () => {
    for (const key of ['branchPrefix', 'hooks', 'syncFiles', 'syncRemote', 'worktreePath']) {
      expect(KNOWN_CONFIG_KEYS.has(key)).toBe(true);
    }
  });
});

describe('loadEffectiveConfig – onWarning callback', () => {
  it('emits a warning for an unknown key in local config', async () => {
    // Given a local config with a key that looks like a typo of "branchPrefix".
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'gji-repo-'));
    const warnings: string[] = [];

    await writeFile(
      join(repoRoot, CONFIG_FILE_NAME),
      JSON.stringify({ branchPrefx: 'feat/' }),
      'utf8',
    );

    // When loadEffectiveConfig is called with an onWarning callback.
    await loadEffectiveConfig(repoRoot, home, (msg) => warnings.push(msg));

    // Then the warning mentions the unknown key and suggests a correction.
    expect(warnings.join('')).toContain('"branchPrefx"');
    expect(warnings.join('')).toContain('"branchPrefix"');
  });

  it('emits a warning for an unknown key in global config', async () => {
    // Given a global config with an unrecognised key.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'gji-repo-'));
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    const warnings: string[] = [];

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({ synkRemote: 'upstream' }),
      'utf8',
    );

    // When loadEffectiveConfig is called.
    await loadEffectiveConfig(repoRoot, home, (msg) => warnings.push(msg));

    // Then a warning is emitted for the unknown global key.
    expect(warnings.join('')).toContain('"synkRemote"');
  });

  it('emits no warnings when all keys are known', async () => {
    // Given a local config with only valid keys.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'gji-repo-'));
    const warnings: string[] = [];

    await writeFile(
      join(repoRoot, CONFIG_FILE_NAME),
      JSON.stringify({ branchPrefix: 'feat/', hooks: { afterCreate: 'echo hi' } }),
      'utf8',
    );

    // When loadEffectiveConfig is called.
    await loadEffectiveConfig(repoRoot, home, (msg) => warnings.push(msg));

    // Then no warnings are emitted.
    expect(warnings).toHaveLength(0);
  });

  it('does not call onWarning at all when no config files exist', async () => {
    // Given no config files anywhere.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'gji-repo-'));
    const warnings: string[] = [];

    // When loadEffectiveConfig is called.
    await loadEffectiveConfig(repoRoot, home, (msg) => warnings.push(msg));

    // Then no warnings are emitted.
    expect(warnings).toHaveLength(0);
  });

  it('does not emit warnings when no onWarning callback is provided', async () => {
    // Given a local config with an unknown key but no callback registered.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await mkdtemp(join(tmpdir(), 'gji-repo-'));

    await writeFile(
      join(repoRoot, CONFIG_FILE_NAME),
      JSON.stringify({ unknownKey: true }),
      'utf8',
    );

    // When loadEffectiveConfig is called without a callback.
    await expect(loadEffectiveConfig(repoRoot, home)).resolves.toBeDefined();
  });
});
