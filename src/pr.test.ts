import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { createPrCommand, parsePrInput, runPrCommand } from './pr.js';
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

describe('parsePrInput', () => {
  it.each([
    ['123', '123'],
    ['#123', '123'],
    ['https://github.com/owner/repo/pull/123', '123'],
    ['https://github.com/owner/repo/pull/123/files', '123'],
    ['https://gitlab.com/owner/repo/-/merge_requests/456', '456'],
    ['https://gitlab.mycompany.com/group/sub/repo/-/merge_requests/789', '789'],
    ['https://bitbucket.org/owner/repo/pull-requests/321', '321'],
  ])('parses %s as PR number %s', (input, expected) => {
    expect(parsePrInput(input)).toBe(expected);
  });

  it.each([
    ['abc'],
    ['not-a-url'],
    [''],
  ])('returns null for unrecognized input %s', (input) => {
    expect(parsePrInput(input)).toBeNull();
  });
});

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

  it('rejects unrecognized input', async () => {
    // Given a repository and an unrecognizable PR reference.
    const repoRoot = await createRepository();
    const stderr: string[] = [];

    // When gji pr is called with an unrecognized argument.
    const result = await runPrCommand({
      cwd: repoRoot,
      number: 'abc',
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    // Then it exits with an error without touching git.
    expect(result).toBe(1);
    expect(stderr.join('')).toContain('abc');
  });

  it('accepts a GitHub PR URL', async () => {
    // Given a repository with a PR ref on origin.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branchName = 'feature/url-input';
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/555');

    await runGit(repoRoot, ['checkout', '-b', branchName]);
    await commitFile(repoRoot, 'url-input.txt', 'url input\n', 'url input');
    await pushPullRequestRef(repoRoot, '555');
    await runGit(repoRoot, ['checkout', '-']);

    // When gji pr is called with a full GitHub URL.
    const result = await runCli(['pr', 'https://github.com/owner/repo/pull/555'], {
      cwd: repoRoot,
    });

    // Then it creates the worktree by extracting the PR number from the URL.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe('pr/555');
  });

  it('accepts a #-prefixed PR number', async () => {
    // Given a repository with a PR ref on origin.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branchName = 'feature/hash-input';
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/777');

    await runGit(repoRoot, ['checkout', '-b', branchName]);
    await commitFile(repoRoot, 'hash-input.txt', 'hash input\n', 'hash input');
    await pushPullRequestRef(repoRoot, '777');
    await runGit(repoRoot, ['checkout', '-']);

    // When gji pr is called with a #-prefixed number.
    const result = await runCli(['pr', '#777'], { cwd: repoRoot });

    // Then it creates the worktree correctly.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe('pr/777');
  });

  it('reports a clear error when the PR does not exist on origin', async () => {
    // Given a repository with an origin remote but no PR ref for number 9999.
    const { repoRoot } = await createRepositoryWithOrigin();
    const stderr: string[] = [];

    // When gji pr tries to fetch a non-existent PR.
    const result = await runPrCommand({
      cwd: repoRoot,
      number: '9999',
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    // Then it exits with an error mentioning the PR number.
    expect(result).toBe(1);
    expect(stderr.join('')).toContain('9999');
  });

  it('attaches to an existing pr branch instead of recreating it', async () => {
    // Given a repository where the pr/123 branch already exists locally but has no worktree.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branchName = 'feature/pre-existing-pr-branch';
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/123');

    await runGit(repoRoot, ['checkout', '-b', branchName]);
    await commitFile(repoRoot, 'pre-existing.txt', 'pre-existing\n', 'pre-existing');
    await pushPullRequestRef(repoRoot, '123');
    await runGit(repoRoot, ['checkout', '-']);
    // Fetch the ref and create the local branch manually (simulating a previous run that cleaned up the worktree)
    await runGit(repoRoot, ['fetch', 'origin', 'refs/pull/123/head:refs/remotes/origin/pull/123/head']);
    await runGit(repoRoot, ['branch', 'pr/123', 'refs/remotes/origin/pull/123/head']);

    // When gji pr runs and the pr/123 branch already exists.
    const result = await runCli(['pr', '123'], { cwd: repoRoot });

    // Then it creates the worktree by attaching to the existing branch without error.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe('pr/123');
  });
});
