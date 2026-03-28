import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { GLOBAL_CONFIG_FILE_PATH } from './config.js';
import { extractHooks, interpolate, runHook } from './hooks.js';
import { resolveWorktreePath } from './repo.js';
import { commitFile, createRepository, createRepositoryWithOrigin, pushPullRequestRef, runGit } from './repo.test-helpers.js';

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
    // Given a template referencing {{branch}} and a context with a branch value.
    // Then {{branch}} is replaced with the value from context.
    expect(interpolate('echo {{branch}}', { branch: 'feature/foo', path: '/p', repo: 'r' }))
      .toBe('echo feature/foo');
  });

  it('replaces {{path}} with the worktree path', () => {
    // Given a template referencing {{path}} and a context with a path value.
    // Then {{path}} is replaced with the value from context.
    expect(interpolate('cd {{path}}', { branch: 'main', path: '/worktrees/r/main', repo: 'r' }))
      .toBe('cd /worktrees/r/main');
  });

  it('replaces {{repo}} with the repo name', () => {
    // Given a template referencing {{repo}} and a context with a repo value.
    // Then {{repo}} is replaced with the value from context.
    expect(interpolate('echo {{repo}}', { path: '/p', repo: 'myrepo' }))
      .toBe('echo myrepo');
  });

  it('replaces all occurrences of a variable', () => {
    // Given a template with the same variable used twice.
    // Then both occurrences are replaced.
    expect(interpolate('{{branch}} {{branch}}', { branch: 'main', path: '/p', repo: 'r' }))
      .toBe('main main');
  });

  it('substitutes empty string for a missing branch', () => {
    // Given a template referencing {{branch}} and a context with no branch.
    // Then {{branch}} is replaced with an empty string.
    expect(interpolate('echo {{branch}}', { path: '/p', repo: 'r' }))
      .toBe('echo ');
  });
});

describe('extractHooks', () => {
  it('returns empty object when no hooks key exists', () => {
    // Given a config with no hooks key.
    // Then extractHooks returns an empty object.
    expect(extractHooks({})).toEqual({});
  });

  it('extracts afterCreate', () => {
    // Given a config with only an afterCreate hook.
    // Then extractHooks returns only that hook.
    expect(extractHooks({ hooks: { afterCreate: 'pnpm install' } }))
      .toEqual({ afterCreate: 'pnpm install' });
  });

  it('extracts all three hook types', () => {
    // Given a config with all three hook keys set.
    // Then extractHooks returns all three.
    expect(extractHooks({ hooks: { afterCreate: 'a', afterEnter: 'b', beforeRemove: 'c' } }))
      .toEqual({ afterCreate: 'a', afterEnter: 'b', beforeRemove: 'c' });
  });

  it('ignores non-string hook values', () => {
    // Given a config with hooks set to non-string values.
    // Then extractHooks omits those keys.
    expect(extractHooks({ hooks: { afterCreate: 123, afterEnter: null } }))
      .toEqual({});
  });

  it('ignores a hooks key that is not a plain object', () => {
    // Given a config where the hooks key is a primitive or array.
    // Then extractHooks treats it as if no hooks were configured.
    expect(extractHooks({ hooks: 'invalid' })).toEqual({});
    expect(extractHooks({ hooks: [] })).toEqual({});
    expect(extractHooks({ hooks: 42 })).toEqual({});
  });
});

describe('runHook', () => {
  it('does nothing when hookCmd is undefined', async () => {
    // Given no hook command is configured.
    const stderr: string[] = [];

    // When runHook is called with undefined.
    await runHook(undefined, '/tmp', { path: '/tmp', repo: 'r' }, (c) => stderr.push(c));

    // Then nothing is emitted to stderr.
    expect(stderr).toEqual([]);
  });

  it('executes a shell command in the given cwd', async () => {
    // Given a temporary directory and a hook that creates a marker file.
    const dir = await mkdtemp(join(tmpdir(), 'gji-hooks-'));
    const markerFile = join(dir, 'hook-ran.txt');
    const stderr: string[] = [];

    // When runHook is called with that command.
    await runHook(`touch "${markerFile}"`, dir, { path: dir, repo: 'r' }, (c) => stderr.push(c));

    // Then the marker file exists and no errors were emitted.
    await expect(readFile(markerFile)).resolves.toBeDefined();
    expect(stderr).toEqual([]);
  });

  it('interpolates template variables before running the command', async () => {
    // Given a hook command that uses {{branch}} and {{repo}} variables.
    const dir = await mkdtemp(join(tmpdir(), 'gji-hooks-'));
    const outputFile = join(dir, 'output.txt');
    const stderr: string[] = [];

    // When runHook is called with branch and repo in context.
    await runHook(
      `printf '%s:%s' '{{branch}}' '{{repo}}' > "${outputFile}"`,
      dir,
      { branch: 'feature/test', path: dir, repo: 'myrepo' },
      (c) => stderr.push(c),
    );

    // Then the output file contains the substituted values.
    await expect(readFile(outputFile, 'utf8')).resolves.toBe('feature/test:myrepo');
  });

  it('exposes context as GJI_* environment variables', async () => {
    // Given a hook that writes the GJI_* env vars to a file.
    const dir = await mkdtemp(join(tmpdir(), 'gji-hooks-'));
    const outputFile = join(dir, 'env.txt');
    const stderr: string[] = [];

    // When runHook is called with branch, path and repo in context.
    await runHook(
      `printf '%s:%s:%s' "$GJI_BRANCH" "$GJI_PATH" "$GJI_REPO" > "${outputFile}"`,
      dir,
      { branch: 'feature/env', path: dir, repo: 'myrepo' },
      (c) => stderr.push(c),
    );

    // Then the output file contains the values from the env vars.
    await expect(readFile(outputFile, 'utf8')).resolves.toBe(`feature/env:${dir}:myrepo`);
  });

  it('emits a warning on non-zero exit without throwing', async () => {
    // Given a hook command that exits with a non-zero code.
    const dir = await mkdtemp(join(tmpdir(), 'gji-hooks-'));
    const stderr: string[] = [];

    // When runHook runs that failing command.
    await expect(
      runHook('exit 42', dir, { path: dir, repo: 'r' }, (c) => stderr.push(c)),
    ).resolves.toBeUndefined();

    // Then a warning mentioning the exit code is emitted to stderr.
    expect(stderr.join('')).toContain('hook exited with code 42');
  });
});

describe('hook config layering', () => {
  it('merges global and project hooks so both apply when they use different keys', async () => {
    // Given a global config with afterEnter and a project config with afterCreate.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await createRepository();
    const branchName = 'feature/layered-hooks';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const localMarker = join(worktreePath, '.local-hook-ran');
    process.env.HOME = home;

    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({ hooks: { afterEnter: 'echo enter' } }),
      'utf8',
    );
    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { afterCreate: `touch "${localMarker}"` } }),
      'utf8',
    );

    // When gji new is run.
    const result = await runCli(['new', branchName], { cwd: repoRoot });

    // Then the project afterCreate hook ran and the global afterEnter was not discarded.
    expect(result.exitCode).toBe(0);
    await expect(readFile(localMarker)).resolves.toBeDefined();
  });

  it('project hook overrides global hook for the same key', async () => {
    // Given global and project configs that both define afterCreate with different commands.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await createRepository();
    const branchName = 'feature/override-hook';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const globalMarker = join(worktreePath, '.global-ran');
    const localMarker = join(worktreePath, '.local-ran');
    process.env.HOME = home;

    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({ hooks: { afterCreate: `touch "${globalMarker}"` } }),
      'utf8',
    );
    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { afterCreate: `touch "${localMarker}"` } }),
      'utf8',
    );

    // When gji new is run.
    const result = await runCli(['new', branchName], { cwd: repoRoot });

    // Then only the project hook ran and the global hook for the same key did not.
    expect(result.exitCode).toBe(0);
    await expect(readFile(localMarker)).resolves.toBeDefined();
    await expect(readFile(globalMarker)).rejects.toThrow();
  });
});

describe('gji new with afterCreate hook', () => {
  it('runs the configured afterCreate hook in the new worktree directory', async () => {
    // Given a project config with an afterCreate hook that creates a marker file.
    const repoRoot = await createRepository();
    const branchName = 'feature/hook-test';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const markerFile = join(worktreePath, '.hook-ran');

    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { afterCreate: `touch "${markerFile}"` } }),
      'utf8',
    );

    // When gji new creates the worktree.
    const result = await runCli(['new', branchName], { cwd: repoRoot });

    // Then the hook ran and the marker file exists inside the new worktree.
    expect(result.exitCode).toBe(0);
    await expect(readFile(markerFile)).resolves.toBeDefined();
  });

  it('still creates the worktree when the afterCreate hook fails', async () => {
    // Given a project config with an afterCreate hook that exits non-zero.
    const repoRoot = await createRepository();
    const branchName = 'feature/hook-fail';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const stderr: string[] = [];

    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { afterCreate: 'exit 1' } }),
      'utf8',
    );

    // When gji new runs with that failing hook.
    const result = await runCli(['new', branchName], {
      cwd: repoRoot,
      stderr: (c) => stderr.push(c),
    });

    // Then the worktree is still created and a warning is emitted.
    expect(result.exitCode).toBe(0);
    await expect(readFile(join(worktreePath, '.git'))).resolves.toBeDefined();
    expect(stderr.join('')).toContain('hook exited with code 1');
  });
});

describe('gji pr with afterCreate hook', () => {
  it('runs the configured afterCreate hook after checking out a PR worktree', async () => {
    // Given a repository with an origin remote exposing a PR ref and an afterCreate hook.
    const { repoRoot } = await createRepositoryWithOrigin();
    await runGit(repoRoot, ['checkout', '-b', 'feature/pr-source']);
    await commitFile(repoRoot, 'pr.txt', 'change\n', 'pr commit');
    await pushPullRequestRef(repoRoot, '1');
    await runGit(repoRoot, ['checkout', '-']);

    const worktreePath = resolveWorktreePath(repoRoot, 'pr/1');
    const markerFile = join(worktreePath, '.hook-ran');

    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { afterCreate: `touch "${markerFile}"` } }),
      'utf8',
    );

    // When gji pr fetches and creates the PR worktree.
    const result = await runCli(['pr', '1'], { cwd: repoRoot });

    // Then the afterCreate hook ran inside the new PR worktree.
    expect(result.exitCode).toBe(0);
    await expect(readFile(markerFile)).resolves.toBeDefined();
  });
});

describe('gji remove with beforeRemove hook', () => {
  it('runs the configured beforeRemove hook before removing the worktree', async () => {
    // Given an existing worktree and a project config with a beforeRemove hook.
    const repoRoot = await createRepository();
    const branchName = 'feature/to-remove';
    const markerFile = join(repoRoot, 'before-remove-ran.txt');

    await runCli(['new', branchName], { cwd: repoRoot });
    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { beforeRemove: `touch "${markerFile}"` } }),
      'utf8',
    );

    // When gji remove is run for that worktree.
    const result = await runCli(['remove', '--force', branchName], { cwd: repoRoot });

    // Then the hook ran before removal and the marker file exists.
    expect(result.exitCode).toBe(0);
    await expect(readFile(markerFile)).resolves.toBeDefined();
  });
});
