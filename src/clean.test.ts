import { describe, expect, it } from 'vitest';

import { createCleanCommand } from './clean.js';
import {
  addLinkedWorktree,
  createRepository,
  pathExists,
  runGit,
} from './repo.test-helpers.js';

describe('gji clean', () => {
  it('removes selected linked worktrees after confirmation', async () => {
    // Given a repository root with two linked worktrees selected for cleanup.
    const repoRoot = await createRepository();
    const branches = ['feature/clean-one', 'feature/clean-two'];
    const worktrees = await Promise.all(
      branches.map(async (branch) => ({ branch, path: await addLinkedWorktree(repoRoot, branch) })),
    );
    const runCleanCommand = createCleanCommand({
      confirmRemoval: async (selected) => {
        expect(selected.map((worktree) => worktree.branch)).toEqual(branches);
        return true;
      },
      promptForWorktrees: async (linkedWorktrees) => {
        expect(linkedWorktrees.map((worktree) => worktree.branch)).toEqual(branches);
        return linkedWorktrees.map((worktree) => worktree.path);
      },
    });

    // When gji clean removes the selected worktrees after confirmation.
    expect(await runCleanCommand({ cwd: repoRoot, stderr: () => undefined, stdout: () => undefined })).toBe(0);

    // Then the linked worktrees are removed while their branches remain.
    for (const worktree of worktrees) {
      await expect(pathExists(worktree.path)).resolves.toBe(false);
      await expect(branchExists(repoRoot, worktree.branch)).resolves.toBe(true);
    }
  });

  it('aborts when confirmation is rejected', async () => {
    // Given a repository root with a linked worktree selected for cleanup.
    const repoRoot = await createRepository();
    const branch = 'feature/clean-abort';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    const stderr: string[] = [];
    const runCleanCommand = createCleanCommand({
      confirmRemoval: async () => false,
      promptForWorktrees: async (linkedWorktrees) => linkedWorktrees.map((worktree) => worktree.path),
    });

    // When gji clean is rejected at the confirmation step.
    expect(await runCleanCommand({ cwd: repoRoot, stderr: (chunk) => stderr.push(chunk), stdout: () => undefined })).toBe(1);

    // Then it leaves the worktree in place and reports the abort.
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    expect(stderr.join('')).toContain('Aborted');
  });

  it('refuses to prompt when there are no linked worktrees to clean', async () => {
    // Given a repository root without any linked worktrees.
    const repoRoot = await createRepository();
    const stderr: string[] = [];
    const runCleanCommand = createCleanCommand({
      confirmRemoval: async () => {
        throw new Error('confirmRemoval should not run without linked worktrees');
      },
      promptForWorktrees: async () => {
        throw new Error('promptForWorktrees should not run without linked worktrees');
      },
    });

    // When gji clean runs from that repository root.
    expect(await runCleanCommand({
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    })).toBe(1);

    // Then it exits safely with a descriptive message.
    expect(stderr.join('')).toContain('No linked worktrees to clean');
  });
});

async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  return (await runGit(repoRoot, ['branch', '--list', branch])) !== '';
}
