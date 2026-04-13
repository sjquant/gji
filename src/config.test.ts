import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CONFIG_FILE_NAME,
  DEFAULT_CONFIG,
  GLOBAL_CONFIG_FILE_PATH,
  loadConfig,
  loadEffectiveConfig,
  saveLocalConfig,
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
