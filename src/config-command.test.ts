import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { GLOBAL_CONFIG_FILE_PATH, parseConfigValue } from './config.js';
import { runCli } from './cli.js';

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
    return;
  }

  process.env.HOME = originalHome;
});

describe('gji config', () => {
  it('prints the global config without requiring a git repository', async () => {
    // Given a non-repository working directory and an isolated home directory.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));
    const stdout: string[] = [];
    process.env.HOME = home;

    // When gji config runs from that directory.
    const result = await runCli(['config'], {
      cwd,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the current global config as JSON.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('').trim()).toBe('{}');
  });

  it('sets and gets a global config value', async () => {
    // Given an isolated home directory and a non-repository working directory.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));
    const stdout: string[] = [];
    process.env.HOME = home;

    // When gji config stores a global default.
    const setResult = await runCli(['config', 'set', 'branchPrefix', 'feature/'], {
      cwd,
    });
    const getResult = await runCli(['config', 'get', 'branchPrefix'], {
      cwd,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the value is persisted and can be read back outside a repository.
    expect(setResult.exitCode).toBe(0);
    expect(getResult.exitCode).toBe(0);
    expect(stdout.join('').trim()).toBe('"feature/"');
    await expect(readGlobalConfig(home)).resolves.toEqual({
      branchPrefix: 'feature/',
    });
  });

  it('unsets a global config value', async () => {
    // Given an isolated home directory with an existing global config value.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));
    process.env.HOME = home;

    await runCli(['config', 'set', 'branchPrefix', 'feature/'], {
      cwd,
    });

    // When gji config unsets that value.
    const result = await runCli(['config', 'unset', 'branchPrefix'], {
      cwd,
    });

    // Then the key is removed from the persisted global config.
    expect(result.exitCode).toBe(0);
    await expect(readGlobalConfig(home)).resolves.toEqual({});
  });

  it('parses JSON-shaped config values before storing them', async () => {
    // Given an isolated home directory and a non-repository working directory.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));
    process.env.HOME = home;

    // When gji config stores a JSON literal value.
    const result = await runCli(['config', 'set', 'fetchDepth', '2'], {
      cwd,
    });

    // Then the stored value keeps its parsed JSON type.
    expect(result.exitCode).toBe(0);
    await expect(readGlobalConfig(home)).resolves.toEqual({
      fetchDepth: parseConfigValue('2'),
    });
  });
});

async function readGlobalConfig(home: string): Promise<Record<string, unknown>> {
  const rawConfig = await readFile(GLOBAL_CONFIG_FILE_PATH(home), 'utf8');

  return JSON.parse(rawConfig) as Record<string, unknown>;
}
