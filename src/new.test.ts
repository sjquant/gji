import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { GLOBAL_CONFIG_FILE_PATH } from './config.js';
import { resolveWorktreePath } from './repo.js';
import {
  addLinkedWorktree,
  createRepository,
  currentBranch,
  pathExists,
} from './repo.test-helpers.js';
import { createNewCommand, runNewCommand } from './new.js';

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
    return;
  }

  process.env.HOME = originalHome;
});

describe('gji new', () => {
  it('creates a branch and linked worktree from the repository root', async () => {
    // Given a repository root and a new branch name.
    const repoRoot = await createRepository();
    const stdout: string[] = [];
    const branchName = 'feature/add-command';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);

    // When gji creates a new worktree for that branch.
    const result = await runCli(['new', branchName], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the branch and worktree exist at the deterministic path.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe(branchName);
    expect(stdout.join('')).toContain(worktreePath);
  });

  it('creates the branch from the main repository even when run inside a worktree', async () => {
    // Given an existing linked worktree and a second branch to create.
    const repoRoot = await createRepository();
    const existingBranch = 'feature/existing';
    const existingWorktreePath = await addLinkedWorktree(repoRoot, existingBranch);
    const newBranch = 'feature/from-worktree';
    const newWorktreePath = resolveWorktreePath(repoRoot, newBranch);
    const nestedCwd = join(existingWorktreePath, 'nested');
    await mkdir(nestedCwd, { recursive: true });

    // When gji new runs from inside that linked worktree.
    const result = await runCli(['new', newBranch], {
      cwd: nestedCwd,
    });

    // Then it still creates the new branch/worktree from the main repository.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(newWorktreePath)).resolves.toBe(true);
    await expect(currentBranch(newWorktreePath)).resolves.toBe(newBranch);
  });

  it('applies a global branch prefix when creating a new worktree', async () => {
    // Given an isolated home directory with a configured default branch prefix.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await createRepository();
    const stdout: string[] = [];
    const branchName = 'add-command';
    const prefixedBranchName = `feature/${branchName}`;
    const worktreePath = resolveWorktreePath(repoRoot, prefixedBranchName);
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    process.env.HOME = home;

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({ branchPrefix: 'feature/' }),
      'utf8',
    );

    // When gji new creates a worktree for an unprefixed branch name.
    const result = await runCli(['new', branchName], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it creates the prefixed branch/worktree from the configured default.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe(prefixedBranchName);
    expect(stdout.join('')).toContain(worktreePath);
  });

  it('prefers a repo-local branch prefix over the global default', async () => {
    // Given global and repo-local branch prefix defaults.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await createRepository();
    const branchName = 'add-command';
    const prefixedBranchName = `repo/${branchName}`;
    const worktreePath = resolveWorktreePath(repoRoot, prefixedBranchName);
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    process.env.HOME = home;

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({ branchPrefix: 'feature/' }),
      'utf8',
    );
    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ branchPrefix: 'repo/' }),
      'utf8',
    );

    // When gji new runs inside that repository.
    const result = await runCli(['new', branchName], {
      cwd: repoRoot,
    });

    // Then the repo-local prefix wins over the global default.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe(prefixedBranchName);
  });

  it('reuses the existing path when the conflict prompt selects reuse', async () => {
    // Given an existing target path for the requested branch.
    const repoRoot = await createRepository();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const branchName = 'feature/existing-path';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const runNewCommand = createNewCommand({
      promptForPathConflict: async () => 'reuse',
    });

    await mkdir(worktreePath, { recursive: true });

    // When the interactive conflict handler selects reuse.
    const result = await runNewCommand({
      branch: branchName,
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the command exits successfully and returns the existing path.
    expect(result).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('')).toContain(worktreePath);
  });

  it('aborts when the conflict prompt selects abort', async () => {
    // Given an existing target path for the requested branch.
    const repoRoot = await createRepository();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const branchName = 'feature/abort-existing-path';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const runNewCommand = createNewCommand({
      promptForPathConflict: async () => 'abort',
    });

    await mkdir(worktreePath, { recursive: true });

    // When the interactive conflict handler selects abort.
    const result = await runNewCommand({
      branch: branchName,
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the command exits without creating or reusing the worktree.
    expect(result).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toContain('Aborted');
  });
});
