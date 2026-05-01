import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { HISTORY_FILE_PATH, appendHistory, loadHistory } from './history.js';
import { formatAge, formatHistoryList } from './back.js';
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

describe('appendHistory / loadHistory', () => {
  it('stores an entry and reads it back', async () => {
    const home = await makeHome();
    await appendHistory('/worktrees/repo/feature', 'feature', home);
    const history = await loadHistory(home);

    expect(history).toHaveLength(1);
    expect(history[0].path).toBe('/worktrees/repo/feature');
    expect(history[0].branch).toBe('feature');
    expect(typeof history[0].timestamp).toBe('number');
  });

  it('prepends new entries so the most recent is first', async () => {
    const home = await makeHome();
    await appendHistory('/worktrees/repo/a', 'a', home);
    await appendHistory('/worktrees/repo/b', 'b', home);

    const history = await loadHistory(home);
    expect(history[0].path).toBe('/worktrees/repo/b');
    expect(history[1].path).toBe('/worktrees/repo/a');
  });

  it('skips append when the last entry is the same path', async () => {
    const home = await makeHome();
    await appendHistory('/worktrees/repo/a', 'a', home);
    await appendHistory('/worktrees/repo/a', 'a', home);

    const history = await loadHistory(home);
    expect(history).toHaveLength(1);
  });

  it('returns empty array when history file does not exist', async () => {
    const home = await makeHome();
    const history = await loadHistory(home);
    expect(history).toEqual([]);
  });

  it('returns empty array when history file contains invalid JSON', async () => {
    const home = await makeHome();
    const path = HISTORY_FILE_PATH(home);
    const { mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'not-json', 'utf8');

    const history = await loadHistory(home);
    expect(history).toEqual([]);
  });
});

describe('formatHistoryList', () => {
  it('marks the current path with an asterisk', () => {
    const now = Date.now();
    const history = [
      { path: '/worktrees/repo/b', branch: 'feature/b', timestamp: now },
      { path: '/worktrees/repo/a', branch: 'feature/a', timestamp: now - 3600_000 },
    ];
    const output = formatHistoryList(history, '/worktrees/repo/b');
    const lines = output.trim().split('\n');

    expect(lines[1]).toMatch(/^\*/);
    expect(lines[2]).toMatch(/^ /);
  });

  it('shows "(detached)" for null branches', () => {
    const history = [{ path: '/worktrees/repo/scratch', branch: null, timestamp: Date.now() }];
    const output = formatHistoryList(history, '/other');
    expect(output).toContain('(detached)');
  });

  it('renders a header row', () => {
    const history = [{ path: '/p', branch: 'main', timestamp: Date.now() }];
    const output = formatHistoryList(history, '/other');
    expect(output).toMatch(/BRANCH.*WHEN.*PATH/);
  });
});

describe('formatAge', () => {
  it('returns "just now" for recent timestamps', () => {
    expect(formatAge(Date.now() - 5_000)).toBe('just now');
  });

  it('returns minutes for timestamps under an hour', () => {
    expect(formatAge(Date.now() - 5 * 60_000)).toBe('5m ago');
  });

  it('returns hours for timestamps under a day', () => {
    expect(formatAge(Date.now() - 3 * 3600_000)).toBe('3h ago');
  });

  it('returns days for older timestamps', () => {
    expect(formatAge(Date.now() - 2 * 86400_000)).toBe('2d ago');
  });
});

describe('gji back', () => {
  it('returns error when history is empty', async () => {
    const home = await makeHome();
    process.env.HOME = home;
    const repoRoot = await createRepository();
    const stderr: string[] = [];

    const result = await runCli(['back'], {
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    expect(result.exitCode).toBe(1);
    expect(stderr.join('')).toContain('no previous worktree');
  });

  it('navigates to the previous worktree', async () => {
    const home = await makeHome();
    process.env.HOME = home;
    const repoRoot = await createRepository();
    const worktreePath = await addLinkedWorktree(repoRoot, 'feature/x');
    const stdout: string[] = [];

    await appendHistory(worktreePath, 'feature/x', home);

    const result = await runCli(['back'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
      stderr: () => undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
  });

  it('toggles between two worktrees on repeated back calls', async () => {
    const home = await makeHome();
    process.env.HOME = home;
    const repoRoot = await createRepository();
    const wtA = await addLinkedWorktree(repoRoot, 'branch-a');
    const wtB = await addLinkedWorktree(repoRoot, 'branch-b');

    await appendHistory(wtA, 'branch-a', home);
    await appendHistory(wtB, 'branch-b', home);

    // From wtB → should go to wtA
    const stdout1: string[] = [];
    const result1 = await runCli(['back'], {
      cwd: wtB,
      stdout: (chunk) => stdout1.push(chunk),
      stderr: () => undefined,
    });
    expect(result1.exitCode).toBe(0);
    expect(stdout1.join('')).toBe(`${wtA}\n`);

    // From wtA → should go back to wtB (history updated after first back)
    const stdout2: string[] = [];
    const result2 = await runCli(['back'], {
      cwd: wtA,
      stdout: (chunk) => stdout2.push(chunk),
      stderr: () => undefined,
    });
    expect(result2.exitCode).toBe(0);
    expect(stdout2.join('')).toBe(`${wtB}\n`);
  });

  it('skips a stale entry and navigates to the next valid one', async () => {
    const home = await makeHome();
    process.env.HOME = home;
    const repoRoot = await createRepository();
    const wtA = await addLinkedWorktree(repoRoot, 'branch-a');

    await appendHistory(wtA, 'branch-a', home);
    await appendHistory('/nonexistent/path', 'gone-branch', home);

    const stdout: string[] = [];
    const result = await runCli(['back'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
      stderr: () => undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(`${wtA}\n`);
  });

  it('returns error when all previous entries are stale or missing', async () => {
    const home = await makeHome();
    process.env.HOME = home;
    await appendHistory('/nonexistent/path', 'gone-branch', home);

    const repoRoot = await createRepository();
    const stderr: string[] = [];

    const result = await runCli(['back'], {
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    expect(result.exitCode).toBe(1);
    expect(stderr.join('')).toContain('no previous worktree');
  });

  it('prints a message when history is empty with --list', async () => {
    const home = await makeHome();
    process.env.HOME = home;
    const repoRoot = await createRepository();
    const stdout: string[] = [];

    const result = await runCli(['back', '--list'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
      stderr: () => undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toContain('No navigation history');
  });

  it('prints history with --list', async () => {
    const home = await makeHome();
    process.env.HOME = home;
    const repoRoot = await createRepository();
    const worktreePath = await addLinkedWorktree(repoRoot, 'feature/y');
    await appendHistory(worktreePath, 'feature/y', home);
    await appendHistory(repoRoot, 'main', home);

    const stdout: string[] = [];
    const result = await runCli(['back', '--list'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
      stderr: () => undefined,
    });

    expect(result.exitCode).toBe(0);
    const output = stdout.join('');
    expect(output).toContain('main');
    expect(output).toContain('feature/y');
  });
});
