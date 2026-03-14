import { access, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { constants } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { resolveWorktreePath } from './repo.js';
import { createRepository } from './repo.test-helpers.js';
import { runNewCommand } from './new.js';

const execFileAsync = promisify(execFile);

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
    const existingWorktreePath = resolveWorktreePath(repoRoot, existingBranch);
    const newBranch = 'feature/from-worktree';
    const newWorktreePath = resolveWorktreePath(repoRoot, newBranch);
    const nestedCwd = join(existingWorktreePath, 'nested');

    await execFileAsync('git', ['branch', existingBranch], { cwd: repoRoot });
    await execFileAsync('git', ['worktree', 'add', existingWorktreePath, existingBranch], {
      cwd: repoRoot,
    });
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

  it('reuses the existing path when the conflict prompt selects reuse', async () => {
    // Given an existing target path for the requested branch.
    const repoRoot = await createRepository();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const branchName = 'feature/existing-path';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);

    await mkdir(worktreePath, { recursive: true });

    // When the interactive conflict handler selects reuse.
    const result = await runNewCommand({
      branch: branchName,
      choosePathConflict: async () => 'reuse',
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

    await mkdir(worktreePath, { recursive: true });

    // When the interactive conflict handler selects abort.
    const result = await runNewCommand({
      branch: branchName,
      choosePathConflict: async () => 'abort',
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

async function currentBranch(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['branch', '--show-current'], { cwd });

  return stdout.trim();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
