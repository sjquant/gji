import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  REGISTRY_FILE_PATH,
  loadRegistry,
  registerRepo,
} from './repo-registry.js';

const originalConfigDir = process.env.GJI_CONFIG_DIR;

afterEach(() => {
  if (originalConfigDir === undefined) {
    delete process.env.GJI_CONFIG_DIR;
  } else {
    process.env.GJI_CONFIG_DIR = originalConfigDir;
  }
});

async function makeConfigDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'gji-config-'));
}

describe('REGISTRY_FILE_PATH', () => {
  it('uses GJI_CONFIG_DIR when set', async () => {
    const dir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = dir;

    expect(REGISTRY_FILE_PATH()).toBe(join(dir, 'repos.json'));
  });
});

describe('loadRegistry', () => {
  it('returns an empty array when the file does not exist', async () => {
    const dir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = dir;

    expect(await loadRegistry()).toEqual([]);
  });

  it('returns an empty array when the file contains malformed JSON', async () => {
    const dir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = dir;

    await writeFile(join(dir, 'repos.json'), 'not-json', 'utf8');

    expect(await loadRegistry()).toEqual([]);
  });

  it('returns an empty array when the file contains a non-array', async () => {
    const dir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = dir;

    await writeFile(join(dir, 'repos.json'), '{"key":"value"}', 'utf8');

    expect(await loadRegistry()).toEqual([]);
  });

  it('filters out entries missing required fields', async () => {
    const dir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = dir;

    await writeFile(
      join(dir, 'repos.json'),
      JSON.stringify([
        { path: '/valid', name: 'valid', lastUsed: 1000 },
        { path: '/no-name', lastUsed: 1000 },
        { name: 'no-path', lastUsed: 1000 },
      ]),
      'utf8',
    );

    const registry = await loadRegistry();
    expect(registry).toHaveLength(1);
    expect(registry[0].path).toBe('/valid');
  });
});

describe('registerRepo', () => {
  it('creates an entry for a new repo', async () => {
    const dir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = dir;

    await registerRepo('/home/user/code/my-app');
    const registry = await loadRegistry();

    expect(registry).toHaveLength(1);
    expect(registry[0].path).toBe('/home/user/code/my-app');
    expect(registry[0].name).toBe('my-app');
    expect(typeof registry[0].lastUsed).toBe('number');
  });

  it('moves an existing entry to the front and updates lastUsed', async () => {
    const dir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = dir;

    await registerRepo('/home/user/code/alpha');
    await registerRepo('/home/user/code/beta');
    const beforeTimestamp = (await loadRegistry()).find((e) => e.path === '/home/user/code/alpha')!.lastUsed;

    await registerRepo('/home/user/code/alpha');
    const registry = await loadRegistry();

    expect(registry).toHaveLength(2);
    expect(registry[0].path).toBe('/home/user/code/alpha');
    expect(registry[0].lastUsed).toBeGreaterThanOrEqual(beforeTimestamp);
  });

  it('skips the write when the repo is already the most recent entry', async () => {
    const dir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = dir;

    await registerRepo('/home/user/code/my-app');
    const { lastUsed: firstTimestamp } = (await loadRegistry())[0];

    // Register the same repo again immediately — should be a no-op.
    await registerRepo('/home/user/code/my-app');
    const { lastUsed: secondTimestamp } = (await loadRegistry())[0];

    expect(secondTimestamp).toBe(firstTimestamp);
  });

  it('prepends the newest repo so the list is most-recent-first', async () => {
    const dir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = dir;

    await registerRepo('/home/user/code/alpha');
    await registerRepo('/home/user/code/beta');
    await registerRepo('/home/user/code/gamma');

    const registry = await loadRegistry();
    expect(registry.map((e) => e.name)).toEqual(['gamma', 'beta', 'alpha']);
  });
});
