import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { createGoCommand } from './go.js';
import { addLinkedWorktree, createRepository } from './repo.test-helpers.js';

describe('gji root', () => {
  it('prints the main repository root from the repository root', async () => {
    // Given a repository root.
    const repoRoot = await createRepository();
    const stdout: string[] = [];

    // When gji root runs from that repository root.
    const result = await runCli(['root'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the main repository root path.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('').trim()).toBe(repoRoot);
  });

  it('prints the main repository root from inside a linked worktree', async () => {
    // Given a linked worktree with a nested current working directory.
    const repoRoot = await createRepository();
    const branchName = 'feature/root-from-worktree';
    const worktreePath = await addLinkedWorktree(repoRoot, branchName);
    const nestedCwd = join(worktreePath, 'nested');
    const stdout: string[] = [];

    await mkdir(nestedCwd, { recursive: true });

    // When gji root runs from inside that linked worktree.
    const result = await runCli(['root'], {
      cwd: nestedCwd,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it still prints the main repository root path.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('').trim()).toBe(repoRoot);
  });
});

describe('gji go', () => {
  it('prints the linked worktree path explicitly with --print', async () => {
    // Given an existing linked worktree for a branch.
    const repoRoot = await createRepository();
    const branchName = 'feature/go-print';
    const worktreePath = await addLinkedWorktree(repoRoot, branchName);
    const stdout: string[] = [];

    // When gji go runs in explicit print mode.
    const result = await runCli(['go', '--print', branchName], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the matching worktree path.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('').trim()).toBe(worktreePath);
  });

  it('prints the linked worktree path for a branch', async () => {
    // Given an existing linked worktree for a branch.
    const repoRoot = await createRepository();
    const branchName = 'feature/go-branch';
    const worktreePath = await addLinkedWorktree(repoRoot, branchName);
    const stdout: string[] = [];

    // When gji go runs with that branch name.
    const result = await runCli(['go', branchName], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the matching worktree path.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('').trim()).toBe(worktreePath);
  });

  it('selects an existing worktree interactively when no branch is provided', async () => {
    // Given an existing linked worktree and an interactive chooser.
    const repoRoot = await createRepository();
    const branchName = 'feature/go-select';
    const worktreePath = await addLinkedWorktree(repoRoot, branchName);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const runGoCommand = createGoCommand({
      promptForWorktree: async (worktrees) => {
        expect(worktrees.map((worktree) => worktree.branch)).toContain(branchName);
        return worktreePath;
      },
    });

    // When gji go runs without a branch and the chooser selects that worktree.
    const result = await runGoCommand({
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the selected worktree path.
    expect(result).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('').trim()).toBe(worktreePath);
  });

  it('uses the captured-output prompt mode for interactive --print selection', async () => {
    // Given an existing linked worktree and shell integration prompt mode.
    const repoRoot = await createRepository();
    const branchName = 'feature/go-print-select';
    const worktreePath = await addLinkedWorktree(repoRoot, branchName);
    const originalPromptMode = process.env.GJI_GO_TTY_PROMPT;
    const stdout: string[] = [];
    const stderr: string[] = [];
    let defaultPromptCalled = false;
    let capturedOutputPromptCalled = false;
    const runGoCommand = createGoCommand({
      promptForCapturedOutputWorktree: async (worktrees) => {
        capturedOutputPromptCalled = true;
        expect(worktrees.map((worktree) => worktree.branch)).toContain(branchName);
        return worktreePath;
      },
      promptForWorktree: async () => {
        defaultPromptCalled = true;
        return null;
      },
    });

    process.env.GJI_GO_TTY_PROMPT = '1';

    try {
      // When gji go runs in print mode without a branch.
      const result = await runGoCommand({
        cwd: repoRoot,
        print: true,
        stderr: (chunk) => stderr.push(chunk),
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then it uses the tty-safe prompt path and prints the marked selection.
      expect(result).toBe(0);
      expect(defaultPromptCalled).toBe(false);
      expect(capturedOutputPromptCalled).toBe(true);
      expect(stderr).toEqual([]);
      expect(stdout.join('')).toBe(`__GJI_TARGET__:${worktreePath}\n`);
    } finally {
      if (originalPromptMode === undefined) {
        delete process.env.GJI_GO_TTY_PROMPT;
      } else {
        process.env.GJI_GO_TTY_PROMPT = originalPromptMode;
      }
    }
  });
});
