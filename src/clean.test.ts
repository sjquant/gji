import { describe, expect, it } from 'vitest';

import { createCleanCommand } from './clean.js';
import {
  addLinkedWorktree,
  createRepository,
  pathExists,
  runGit,
} from './repo.test-helpers.js';

describe('gji clean', () => {
  it('removes selected branch-backed and detached worktrees and prints the repo root', async () => {
    // Given a repository root with branch-backed and detached linked worktrees.
    const repoRoot = await createRepository();
    const keepBranch = 'feature/clean-keep';
    const removeBranch = 'feature/clean-remove';
    const keepWorktreePath = await addLinkedWorktree(repoRoot, keepBranch);
    const removeWorktreePath = await addLinkedWorktree(repoRoot, removeBranch);
    const detachedWorktreePath = `${repoRoot}-detached`;
    const stdout: string[] = [];
    await runGit(repoRoot, ['worktree', 'add', '--detach', detachedWorktreePath, 'HEAD']);
    const runCleanCommand = createCleanCommand({
      confirmRemoval: async (worktrees) => {
        expect(worktrees.map((worktree) => worktree.path).sort()).toEqual(
          [detachedWorktreePath, removeWorktreePath].sort(),
        );
        return true;
      },
      promptForWorktrees: async (worktrees) => {
        expect(worktrees.map((worktree) => worktree.branch).sort()).toEqual(
          [keepBranch, removeBranch, null].sort(),
        );
        return [removeWorktreePath, detachedWorktreePath];
      },
    });

    // When gji clean runs and those stale worktrees are selected.
    expect(await runCleanCommand({
      cwd: repoRoot,
      stderr: () => undefined,
      stdout: (chunk) => stdout.push(chunk),
    })).toBe(0);

    // Then it removes only the selected worktrees and their branch when present.
    await expect(pathExists(keepWorktreePath)).resolves.toBe(true);
    await expect(branchExists(repoRoot, keepBranch)).resolves.toBe(true);
    await expect(pathExists(removeWorktreePath)).resolves.toBe(false);
    await expect(branchExists(repoRoot, removeBranch)).resolves.toBe(false);
    await expect(pathExists(detachedWorktreePath)).resolves.toBe(false);
    expect(stdout.join('')).toBe(`${repoRoot}\n`);
  });

  it('fails cleanly when there are no linked worktrees to prune', async () => {
    // Given a repository root without any linked worktrees.
    const repoRoot = await createRepository();
    const stderr: string[] = [];

    // When gji clean runs.
    expect(await createCleanCommand()({
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    })).toBe(1);

    // Then it reports that there is nothing to clean.
    expect(stderr.join('')).toBe('No linked worktrees to clean\n');
  });

  it('aborts cleanly when the interactive selection is cancelled', async () => {
    // Given a repository root with a linked worktree and a cancelled chooser.
    const repoRoot = await createRepository();
    const branch = 'feature/clean-cancel';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    const stderr: string[] = [];
    const runCleanCommand = createCleanCommand({
      confirmRemoval: async () => {
        throw new Error('confirmRemoval should not run after a cancelled prompt');
      },
      promptForWorktrees: async () => null,
    });

    // When gji clean runs and the chooser is cancelled.
    expect(await runCleanCommand({
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    })).toBe(1);

    // Then it leaves the worktree and branch intact and reports the abort.
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(branchExists(repoRoot, branch)).resolves.toBe(true);
    expect(stderr.join('')).toBe('Aborted\n');
  });

  it('aborts without removing anything when confirmation is declined', async () => {
    // Given a repository root with a selected linked worktree and a declined confirmation.
    const repoRoot = await createRepository();
    const branch = 'feature/clean-decline';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    const stderr: string[] = [];
    const runCleanCommand = createCleanCommand({
      confirmRemoval: async (worktrees) => {
        expect(worktrees).toHaveLength(1);
        return false;
      },
      promptForWorktrees: async () => [worktreePath],
    });

    // When gji clean runs and the confirmation is declined.
    expect(await runCleanCommand({
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    })).toBe(1);

    // Then it leaves the worktree and branch intact and reports the abort.
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(branchExists(repoRoot, branch)).resolves.toBe(true);
    expect(stderr.join('')).toBe('Aborted\n');
  });

  it('aborts cleanly when the multi-select submits no worktrees', async () => {
    // Given a repository root with a linked worktree and an empty selection.
    const repoRoot = await createRepository();
    const branch = 'feature/clean-empty';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    const stderr: string[] = [];
    const runCleanCommand = createCleanCommand({
      confirmRemoval: async () => {
        throw new Error('confirmRemoval should not run after an empty selection');
      },
      promptForWorktrees: async () => [],
    });

    // When gji clean runs and no worktrees are selected.
    expect(await runCleanCommand({
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    })).toBe(1);

    // Then it leaves the worktree and branch intact and reports the abort.
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(branchExists(repoRoot, branch)).resolves.toBe(true);
    expect(stderr.join('')).toBe('Aborted\n');
  });

  it('does not offer the current linked worktree as a clean candidate', async () => {
    // Given a repository with two linked worktrees and one of them is the current cwd.
    const repoRoot = await createRepository();
    const currentBranch = 'feature/clean-current';
    const otherBranch = 'feature/clean-other';
    const currentWorktreePath = await addLinkedWorktree(repoRoot, currentBranch);
    const otherWorktreePath = await addLinkedWorktree(repoRoot, otherBranch);
    const runCleanCommand = createCleanCommand({
      confirmRemoval: async () => true,
      promptForWorktrees: async (worktrees) => {
        expect(worktrees.map((worktree) => worktree.path)).toEqual([otherWorktreePath]);
        return [otherWorktreePath];
      },
    });

    // When gji clean runs from inside the current linked worktree.
    expect(await runCleanCommand({
      cwd: currentWorktreePath,
      stderr: () => undefined,
      stdout: () => undefined,
    })).toBe(0);

    // Then it excludes the current worktree and only cleans the other one.
    await expect(pathExists(currentWorktreePath)).resolves.toBe(true);
    await expect(branchExists(repoRoot, currentBranch)).resolves.toBe(true);
    await expect(pathExists(otherWorktreePath)).resolves.toBe(false);
    await expect(branchExists(repoRoot, otherBranch)).resolves.toBe(false);
  });
});

async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  return (await runGit(repoRoot, ['branch', '--list', branch])) !== '';
}
