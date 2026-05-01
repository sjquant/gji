import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { appendHistory } from './history.js';
import { addLinkedWorktree, createRepository } from './repo.test-helpers.js';

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
});

async function makeHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'gji-home-'));
}

describe('gji history', () => {
  it('prints a message when history is empty', async () => {
    // Given an empty history.
    const home = await makeHome();
    process.env.HOME = home;
    const repoRoot = await createRepository();
    const stdout: string[] = [];

    // When gji history is run.
    const result = await runCli(['history'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
      stderr: () => undefined,
    });

    // Then it exits successfully and reports no history.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toContain('No navigation history');
  });

  it('lists visited worktrees with branch, age, and path columns', async () => {
    // Given a history with two entries.
    const home = await makeHome();
    process.env.HOME = home;
    const repoRoot = await createRepository();
    const worktreePath = await addLinkedWorktree(repoRoot, 'feature/y');
    await appendHistory(worktreePath, 'feature/y', home);
    await appendHistory(repoRoot, 'main', home);
    const stdout: string[] = [];

    // When gji history is run.
    const result = await runCli(['history'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
      stderr: () => undefined,
    });

    // Then the output lists both entries.
    expect(result.exitCode).toBe(0);
    const output = stdout.join('');
    expect(output).toContain('main');
    expect(output).toContain('feature/y');
    expect(output).toMatch(/BRANCH.*WHEN.*PATH/);
  });

  it('outputs JSON with --json', async () => {
    // Given a history with one entry.
    const home = await makeHome();
    process.env.HOME = home;
    const repoRoot = await createRepository();
    await appendHistory(repoRoot, 'main', home);
    const stdout: string[] = [];

    // When gji history --json is run.
    const result = await runCli(['history', '--json'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
      stderr: () => undefined,
    });

    // Then the output is a JSON array of history entries.
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(stdout.join('')) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });
});
