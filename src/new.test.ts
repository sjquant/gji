import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
  runGit,
} from './repo.test-helpers.js';
import {
  createNewCommand,
  generateBranchPlaceholder,
  runNewCommand,
} from './new.js';

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
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
  });

  it('creates a detached linked worktree without creating a branch', async () => {
    // Given a repository root and a detached worktree name.
    const repoRoot = await createRepository();
    const stdout: string[] = [];
    const worktreeName = 'detached/scratch-pad';
    const worktreePath = resolveWorktreePath(repoRoot, worktreeName);

    // When gji creates a detached worktree for that name.
    const result = await runCli(['new', '--detached', worktreeName], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the detached worktree exists at the deterministic path without a branch.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe('');
    await expect(runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${worktreeName}`]))
      .rejects
      .toThrow();
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
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

  it('writes the created worktree path to the shell output file without printing it', async () => {
    // Given a repository root and a shell output file.
    const repoRoot = await createRepository();
    const branchName = 'feature/new-output-file';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const outputFile = join(repoRoot, 'created-worktree.txt');
    const originalOutputFile = process.env.GJI_NEW_OUTPUT_FILE;
    const stdout: string[] = [];

    process.env.GJI_NEW_OUTPUT_FILE = outputFile;

    try {
      // When gji new runs via the shell-wrapper output file path.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
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
        delete process.env.GJI_NEW_OUTPUT_FILE;
      } else {
        process.env.GJI_NEW_OUTPUT_FILE = originalOutputFile;
      }
    }
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
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
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

  it('prompts for a branch name with a funny placeholder when none is provided', async () => {
    // Given a repository root and an interactive branch prompt.
    const repoRoot = await createRepository();
    const chosenBranch = 'prometheus-brought-snacks';
    const worktreePath = resolveWorktreePath(repoRoot, chosenBranch);
    const stdout: string[] = [];
    const runNewCommand = createNewCommand({
      createBranchPlaceholder: () => 'socrates-debugged-this',
      promptForBranch: async (placeholder) => {
        expect(placeholder).toBe('socrates-debugged-this');
        return chosenBranch;
      },
    });

    // When gji new runs without an explicit branch.
    const result = await runNewCommand({
      cwd: repoRoot,
      stderr: () => undefined,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it creates the prompted branch/worktree and prints the path.
    expect(result).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe(chosenBranch);
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
  });

  it('uses the generated placeholder for detached worktrees without prompting', async () => {
    // Given a repository root and a detached command without an explicit name.
    const repoRoot = await createRepository();
    const generatedName = 'prometheus-brought-snacks';
    const worktreePath = resolveWorktreePath(repoRoot, generatedName);
    const stdout: string[] = [];
    let promptCalled = false;
    const runNewCommand = createNewCommand({
      createBranchPlaceholder: () => generatedName,
      promptForBranch: async () => {
        promptCalled = true;
        return 'should-not-run';
      },
    });

    // When gji new runs in detached mode without an explicit name.
    const result = await runNewCommand({
      cwd: repoRoot,
      detached: true,
      stderr: () => undefined,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it succeeds without trying to prompt and uses the generated name.
    expect(result).toBe(0);
    expect(promptCalled).toBe(false);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe('');
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
  });

  it('retries detached placeholder names with a suffix when the generated path already exists', async () => {
    // Given a repository root and an auto-generated detached name that already exists.
    const repoRoot = await createRepository();
    const generatedName = 'prometheus-brought-snacks';
    const conflictingPath = resolveWorktreePath(repoRoot, generatedName);
    const retriedPath = resolveWorktreePath(repoRoot, `${generatedName}-2`);
    const stdout: string[] = [];
    let promptCalled = false;
    const runNewCommand = createNewCommand({
      createBranchPlaceholder: () => generatedName,
      promptForBranch: async () => {
        promptCalled = true;
        return 'should-not-run';
      },
    });

    await mkdir(conflictingPath, { recursive: true });

    // When gji new runs in detached mode without an explicit name.
    const result = await runNewCommand({
      cwd: repoRoot,
      detached: true,
      stderr: () => undefined,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it retries with a suffixed name instead of failing or prompting.
    expect(result).toBe(0);
    expect(promptCalled).toBe(false);
    await expect(pathExists(retriedPath)).resolves.toBe(true);
    await expect(currentBranch(retriedPath)).resolves.toBe('');
    expect(stdout.join('')).toBe(`${retriedPath}\n`);
  });

  it('aborts when the branch prompt is cancelled', async () => {
    // Given a repository root and a cancelled branch prompt.
    const repoRoot = await createRepository();
    const stderr: string[] = [];
    const runNewCommand = createNewCommand({
      createBranchPlaceholder: () => 'socrates-debugged-this',
      promptForBranch: async () => null,
    });

    // When gji new runs without an explicit branch and the prompt is cancelled.
    const result = await runNewCommand({
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    // Then it aborts without creating a worktree.
    expect(result).toBe(1);
    expect(stderr.join('')).toBe('Aborted\n');
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
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
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
    expect(stderr.join('')).toBe(
      `Aborted because target worktree path already exists: ${worktreePath}\n`,
    );
  });

  it('generates funny placeholder names as slug-safe mythic human-style branches', () => {
    // Given deterministic random choices.
    const placeholders = [
      generateBranchPlaceholder(() => 0),
      generateBranchPlaceholder(() => 0.49),
      generateBranchPlaceholder(() => 0.99),
    ];

    // Then the generated names stay slug-safe and use the curated funny roots.
    for (const placeholder of placeholders) {
      expect(placeholder).toMatch(/^[a-z0-9-]+$/);
      expect(placeholder.split('-')[0]).toMatch(
        /^(socrates|prometheus|beethoven|ada|turing|hypatia|tesla|curie|diogenes|plato|hephaestus|athena|archimedes|euclid|heraclitus|galileo|newton|lovelace|nietzsche|kafka)$/,
      );
      expect(placeholder.split('-').length).toBeGreaterThan(1);
    }
  });
});
