import { describe, expect, it } from 'vitest';

import { createDoneCommand } from './done.js';
import {
  addLinkedWorktree,
  createRepository,
  pathExists,
  runGit,
} from './repo.test-helpers.js';

describe('gji done', () => {
  it('removes a branch worktree, deletes the branch, and prints the repo root', async () => {
    // Given a repository root with a linked branch worktree to finish.
    const repoRoot = await createRepository();
    const branch = 'feature/done-branch';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    const stdout: string[] = [];
    const runDoneCommand = createDoneCommand({
      confirmRemoval: async (worktree) => {
        expect(worktree.branch).toBe(branch);
        return true;
      },
    });

    // When gji done runs for that branch.
    expect(await runDoneCommand({ branch, cwd: repoRoot, stderr: () => undefined, stdout: (chunk) => stdout.push(chunk) })).toBe(0);

    // Then it removes the worktree, deletes the branch, and prints the repo root.
    await expect(pathExists(worktreePath)).resolves.toBe(false);
    await expect(branchExists(repoRoot, branch)).resolves.toBe(false);
    expect(stdout.join('').trim()).toBe(repoRoot);
  });

  it('prompts for linked branch worktrees and excludes detached entries', async () => {
    // Given a repository root with linked branch worktrees plus a detached worktree.
    const repoRoot = await createRepository();
    await addLinkedWorktree(repoRoot, 'feature/keep');
    const doneBranch = 'feature/prompt-done';
    const doneWorktreePath = await addLinkedWorktree(repoRoot, doneBranch);
    await runGit(repoRoot, ['worktree', 'add', '--detach', `${repoRoot}-detached`, 'HEAD']);
    const runDoneCommand = createDoneCommand({
      confirmRemoval: async () => true,
      promptForBranch: async (worktrees) => {
        expect(worktrees.map((worktree) => worktree.branch)).toEqual(['feature/keep', doneBranch]);
        return doneBranch;
      },
    });

    // When gji done prompts for the branch to finish.
    expect(await runDoneCommand({ cwd: repoRoot, stderr: () => undefined, stdout: () => undefined })).toBe(0);

    // Then only linked branch worktrees are offered and the chosen one is removed.
    await expect(pathExists(doneWorktreePath)).resolves.toBe(false);
    await expect(branchExists(repoRoot, doneBranch)).resolves.toBe(false);
    await expect(branchExists(repoRoot, 'feature/keep')).resolves.toBe(true);
  });

  it('aborts cleanly when the interactive branch prompt is cancelled', async () => {
    // Given a repository root with a linked branch worktree and a cancelled chooser.
    const repoRoot = await createRepository();
    const branch = 'feature/done-cancel';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    const stderr: string[] = [];
    const runDoneCommand = createDoneCommand({
      confirmRemoval: async () => {
        throw new Error('confirmRemoval should not run after a cancelled prompt');
      },
      promptForBranch: async () => null,
    });

    // When gji done runs without a branch and the chooser is cancelled.
    expect(await runDoneCommand({
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    })).toBe(1);

    // Then it leaves the worktree and branch intact and reports the abort.
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(branchExists(repoRoot, branch)).resolves.toBe(true);
    expect(stderr.join('')).toContain('Aborted');
  });
});

async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  return (await runGit(repoRoot, ['branch', '--list', branch])) !== '';
}
