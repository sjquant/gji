import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { createPrCommand, runPrCommand } from './pr.js';
import { resolveWorktreePath } from './repo.js';
import {
  addLinkedWorktree,
  commitFile,
  createRepository,
  createRepositoryWithOrigin,
  currentBranch,
  pathExists,
  pushPullRequestRef,
  runGit,
} from './repo.test-helpers.js';

describe('gji pr', () => {
  it('fetches a PR ref from origin and creates a linked worktree', async () => {
    // Given a repository with an origin remote exposing refs/pull/123/head.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branchName = 'feature/pr-source';
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/123');

    await runGit(repoRoot, ['checkout', '-b', branchName]);
    await commitFile(repoRoot, 'pr-change.txt', 'pr body\n', 'pr source');
    await pushPullRequestRef(repoRoot, '123');
    await runGit(repoRoot, ['checkout', '-']);

    // When gji pr fetches that pull request.
    const result = await runCli(['pr', '123'], {
      cwd: repoRoot,
    });

    // Then it creates a local pr/123 worktree at the deterministic path.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe('pr/123');
  });

  it('works from inside an existing linked worktree', async () => {
    // Given a repository with both an existing worktree and a PR ref on origin.
    const { repoRoot } = await createRepositoryWithOrigin();
    const existingBranch = 'feature/existing-pr-worktree';
    const existingWorktreePath = await addLinkedWorktree(repoRoot, existingBranch);
    const prBranch = 'feature/pr-from-worktree';
    const prWorktreePath = resolveWorktreePath(repoRoot, 'pr/456');
    const nestedCwd = join(existingWorktreePath, 'nested');

    await runGit(repoRoot, ['checkout', '-b', prBranch]);
    await commitFile(
      repoRoot,
      'pr-from-worktree.txt',
      'pr from worktree\n',
      'pr from worktree',
    );
    await pushPullRequestRef(repoRoot, '456');
    await runGit(repoRoot, ['checkout', '-']);
    await mkdir(nestedCwd, { recursive: true });

    // When gji pr runs from inside that linked worktree.
    const result = await runCli(['pr', '456'], {
      cwd: nestedCwd,
    });

    // Then it still creates the PR worktree from the main repository.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(prWorktreePath)).resolves.toBe(true);
    await expect(currentBranch(prWorktreePath)).resolves.toBe('pr/456');
  });

  it('writes the created worktree path to the shell output file without printing it', async () => {
    // Given a repository with a PR ref and a shell output file.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branchName = 'feature/pr-output-file';
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/789');
    const outputFile = join(repoRoot, 'pr-output.txt');
    const originalOutputFile = process.env.GJI_PR_OUTPUT_FILE;
    const stdout: string[] = [];

    await runGit(repoRoot, ['checkout', '-b', branchName]);
    await commitFile(repoRoot, 'pr-output.txt', 'pr output\n', 'pr output');
    await pushPullRequestRef(repoRoot, '789');
    await runGit(repoRoot, ['checkout', '-']);

    process.env.GJI_PR_OUTPUT_FILE = outputFile;

    try {
      // When gji pr runs via the shell-wrapper output file path.
      const result = await runPrCommand({
        cwd: repoRoot,
        number: '789',
        stderr: () => undefined,
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then it writes the created path to the output file instead of stdout.
      expect(result).toBe(0);
      expect(stdout).toEqual([]);
      await expect(pathExists(worktreePath)).resolves.toBe(true);
      await expect(pathExists(outputFile)).resolves.toBe(true);
      await expect(readFile(outputFile, 'utf8')).resolves.toBe(`${worktreePath}\n`);
    } finally {
      if (originalOutputFile === undefined) {
        delete process.env.GJI_PR_OUTPUT_FILE;
      } else {
        process.env.GJI_PR_OUTPUT_FILE = originalOutputFile;
      }
    }
  });

  it('reuses the existing worktree path when the conflict prompt selects reuse', async () => {
    // Given a repository with an existing target path for the PR worktree.
    const repoRoot = await createRepository();
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/999');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const runPrCommand = createPrCommand({
      promptForPathConflict: async () => 'reuse',
    });

    await mkdir(worktreePath, { recursive: true });

    // When the interactive conflict handler selects reuse.
    const result = await runPrCommand({
      cwd: repoRoot,
      number: '999',
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the command exits successfully and returns the existing path.
    expect(result).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
  });

  it('aborts when the conflict prompt selects abort', async () => {
    // Given a repository with an existing target path for the PR worktree.
    const repoRoot = await createRepository();
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/888');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const runPrCommand = createPrCommand({
      promptForPathConflict: async () => 'abort',
    });

    await mkdir(worktreePath, { recursive: true });

    // When the interactive conflict handler selects abort.
    const result = await runPrCommand({
      cwd: repoRoot,
      number: '888',
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the command exits without creating the worktree.
    expect(result).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toBe(
      `Aborted because target worktree path already exists: ${worktreePath}\n`,
    );
  });
});
