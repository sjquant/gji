import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { extractHooks, interpolate, runHook } from './hooks.js';
import { GLOBAL_CONFIG_FILE_PATH } from './config.js';
import { createRepository } from './repo.test-helpers.js';
import { runCli } from './cli.js';
import { resolveWorktreePath } from './repo.js';

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
    return;
  }
  process.env.HOME = originalHome;
});

describe('interpolate', () => {
  it('replaces {{branch}} with the branch name', () => {
    expect(interpolate('echo {{branch}}', { branch: 'feature/foo', path: '/p', repo: 'r' }))
      .toBe('echo feature/foo');
  });

  it('replaces {{path}} with the worktree path', () => {
    expect(interpolate('cd {{path}}', { branch: 'main', path: '/worktrees/r/main', repo: 'r' }))
      .toBe('cd /worktrees/r/main');
  });

  it('replaces {{repo}} with the repo name', () => {
    expect(interpolate('echo {{repo}}', { path: '/p', repo: 'myrepo' }))
      .toBe('echo myrepo');
  });

  it('replaces all occurrences of a variable', () => {
    expect(interpolate('{{branch}} {{branch}}', { branch: 'main', path: '/p', repo: 'r' }))
      .toBe('main main');
  });

  it('substitutes empty string for a missing branch', () => {
    expect(interpolate('echo {{branch}}', { path: '/p', repo: 'r' }))
      .toBe('echo ');
  });
});

describe('extractHooks', () => {
  it('returns empty object when no hooks key exists', () => {
    expect(extractHooks({})).toEqual({});
  });

  it('extracts afterNew', () => {
    expect(extractHooks({ hooks: { afterNew: 'pnpm install' } }))
      .toEqual({ afterNew: 'pnpm install' });
  });

  it('extracts all three hook types', () => {
    expect(extractHooks({ hooks: { afterNew: 'a', afterGo: 'b', beforeRemove: 'c' } }))
      .toEqual({ afterNew: 'a', afterGo: 'b', beforeRemove: 'c' });
  });

  it('ignores non-string hook values', () => {
    expect(extractHooks({ hooks: { afterNew: 123, afterGo: null } }))
      .toEqual({});
  });

  it('ignores hooks key that is not an object', () => {
    expect(extractHooks({ hooks: 'invalid' })).toEqual({});
    expect(extractHooks({ hooks: [] })).toEqual({});
    expect(extractHooks({ hooks: 42 })).toEqual({});
  });
});

describe('runHook', () => {
  it('does nothing when hookCmd is undefined', async () => {
    const stderr: string[] = [];
    await runHook(undefined, '/tmp', { path: '/tmp', repo: 'r' }, (c) => stderr.push(c));
    expect(stderr).toEqual([]);
  });

  it('executes a shell command in the given cwd', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gji-hooks-'));
    const touchFile = join(dir, 'hook-ran.txt');
    const stderr: string[] = [];

    await runHook(`touch "${touchFile}"`, dir, { path: dir, repo: 'r' }, (c) => stderr.push(c));

    await expect(readFile(touchFile)).resolves.toBeDefined();
    expect(stderr).toEqual([]);
  });

  it('interpolates template variables before running the command', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gji-hooks-'));
    const outputFile = join(dir, 'output.txt');
    const stderr: string[] = [];

    await runHook(
      `printf '%s:%s' '{{branch}}' '{{repo}}' > "${outputFile}"`,
      dir,
      { branch: 'feature/test', path: dir, repo: 'myrepo' },
      (c) => stderr.push(c),
    );

    const content = await readFile(outputFile, 'utf8');
    expect(content).toBe('feature/test:myrepo');
  });

  it('emits a warning on non-zero exit without throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gji-hooks-'));
    const stderr: string[] = [];

    await expect(
      runHook('exit 42', dir, { path: dir, repo: 'r' }, (c) => stderr.push(c)),
    ).resolves.toBeUndefined();

    expect(stderr.join('')).toContain('hook exited with code 42');
  });
});

describe('gji new with afterNew hook', () => {
  it('runs the configured afterNew hook in the new worktree directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await createRepository();
    const branchName = 'feature/hook-test';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const markerFile = join(worktreePath, '.hook-ran');
    process.env.HOME = home;

    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { afterNew: `touch "${markerFile}"` } }),
      'utf8',
    );

    const result = await runCli(['new', branchName], { cwd: repoRoot });

    expect(result.exitCode).toBe(0);
    await expect(readFile(markerFile)).resolves.toBeDefined();
  });

  it('still creates the worktree when afterNew hook fails', async () => {
    const repoRoot = await createRepository();
    const branchName = 'feature/hook-fail';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const stderr: string[] = [];

    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { afterNew: 'exit 1' } }),
      'utf8',
    );

    const result = await runCli(['new', branchName], {
      cwd: repoRoot,
      stderr: (c) => stderr.push(c),
    });

    expect(result.exitCode).toBe(0);
    await expect(readFile(join(worktreePath, '.git'))).resolves.toBeDefined();
    expect(stderr.join('')).toContain('hook exited with code 1');
  });
});

describe('gji remove with beforeRemove hook', () => {
  it('runs the configured beforeRemove hook before removing the worktree', async () => {
    const repoRoot = await createRepository();
    const branchName = 'feature/to-remove';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const markerFile = join(repoRoot, 'before-remove-ran.txt');

    await runCli(['new', branchName], { cwd: repoRoot });

    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { beforeRemove: `touch "${markerFile}"` } }),
      'utf8',
    );

    const result = await runCli(['remove', '--force', branchName], { cwd: repoRoot });

    expect(result.exitCode).toBe(0);
    await expect(readFile(markerFile)).resolves.toBeDefined();
  });
});
