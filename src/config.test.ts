import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONFIG_FILE_NAME, DEFAULT_CONFIG, loadConfig } from './config.js';

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
