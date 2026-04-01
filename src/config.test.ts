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
