import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONFIG_FILE_NAME,
  DEFAULT_CONFIG,
  loadConfig,
  saveLocalConfig,
  updateLocalConfigKey,
} from './config.js';

describe('loadConfig', () => {
  it('returns defaults when the config file does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));

    const result = await loadConfig(root);

    expect(result).toEqual({
      config: DEFAULT_CONFIG,
      exists: false,
      path: join(root, CONFIG_FILE_NAME),
    });
  });

  it('merges a project config file with the defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));

    await writeFile(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({ branchPrefix: 'feature/' }),
      'utf8',
    );

    const result = await loadConfig(root);

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
  it('creates the config file when it does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));
    const config = { branchPrefix: 'feat/' };

    const savedPath = await saveLocalConfig(root, config);

    const written = JSON.parse(await readFile(savedPath, 'utf8')) as unknown;
    expect(savedPath).toBe(join(root, CONFIG_FILE_NAME));
    expect(written).toEqual(config);
  });

  it('overwrites an existing config file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));
    const configPath = join(root, CONFIG_FILE_NAME);
    await writeFile(configPath, JSON.stringify({ branchPrefix: 'old/' }), 'utf8');

    await saveLocalConfig(root, { branchPrefix: 'new/' });

    const written = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    expect(written).toEqual({ branchPrefix: 'new/' });
  });

  it('returns the path to the config file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));

    const result = await saveLocalConfig(root, {});

    expect(result).toBe(join(root, CONFIG_FILE_NAME));
  });
});

describe('updateLocalConfigKey', () => {
  it('creates the config file with the key when it does not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));

    const result = await updateLocalConfigKey(root, 'branchPrefix', 'feat/');

    expect(result).toEqual({ branchPrefix: 'feat/' });
    const written = JSON.parse(
      await readFile(join(root, CONFIG_FILE_NAME), 'utf8'),
    ) as unknown;
    expect(written).toEqual({ branchPrefix: 'feat/' });
  });

  it('updates an existing key without losing other keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));
    await writeFile(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({ branchPrefix: 'old/', syncRemote: 'origin' }),
      'utf8',
    );

    const result = await updateLocalConfigKey(root, 'branchPrefix', 'new/');

    expect(result).toEqual({ branchPrefix: 'new/', syncRemote: 'origin' });
  });

  it('adds a new key while preserving existing keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gji-config-'));
    await writeFile(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({ branchPrefix: 'feat/' }),
      'utf8',
    );

    const result = await updateLocalConfigKey(root, 'syncRemote', 'upstream');

    expect(result).toEqual({ branchPrefix: 'feat/', syncRemote: 'upstream' });
  });
});
