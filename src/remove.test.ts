import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRemoveCommand } from './remove.js';
import {
  addLinkedWorktree,
  commitFile,
  createRepository,
  pathExists,
  runGit,
} from './repo.test-helpers.js';

describe('gji remove', () => {
  it('removes a branch worktree, deletes the branch, and prints the repo root', async () => {
    // Given a repository root with a linked branch worktree to remove.
    const repoRoot = await createRepository();
    const branch = 'feature/remove-branch';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    const stdout: string[] = [];
    const runRemoveCommand = createRemoveCommand({
      confirmRemoval: async (worktree) => {
        expect(worktree.branch).toBe(branch);
        return true;
      },
    });

    // When gji remove runs for that branch.
    expect(await runRemoveCommand({ branch, cwd: repoRoot, stderr: () => undefined, stdout: (chunk) => stdout.push(chunk) })).toBe(0);

    // Then it removes the worktree, deletes the branch, and prints the repo root.
    await expect(pathExists(worktreePath)).resolves.toBe(false);
    await expect(branchExists(repoRoot, branch)).resolves.toBe(false);
    expect(stdout.join('').trim()).toBe(repoRoot);
  });

  it('prompts for linked worktrees including detached entries', async () => {
    // Given a repository root with linked branch worktrees plus a detached worktree.
    const repoRoot = await createRepository();
    await addLinkedWorktree(repoRoot, 'feature/keep');
    const removeBranch = 'feature/prompt-remove';
    const removeWorktreePath = await addLinkedWorktree(repoRoot, removeBranch);
    const detachedWorktreePath = `${repoRoot}-detached`;
    await runGit(repoRoot, ['worktree', 'add', '--detach', detachedWorktreePath, 'HEAD']);
    const runRemoveCommand = createRemoveCommand({
      confirmRemoval: async () => true,
      promptForWorktree: async (worktrees) => {
        expect(worktrees.map((worktree) => worktree.branch).sort()).toEqual([removeBranch, 'feature/keep', null].sort());
        expect(worktrees.map((worktree) => worktree.path)).toContain(detachedWorktreePath);
        return removeWorktreePath;
      },
    });

    // When gji remove prompts for the worktree to finish.
    expect(await runRemoveCommand({ cwd: repoRoot, stderr: () => undefined, stdout: () => undefined })).toBe(0);

    // Then the linked worktrees are offered and the chosen branch-backed one is removed.
    await expect(pathExists(removeWorktreePath)).resolves.toBe(false);
    await expect(branchExists(repoRoot, removeBranch)).resolves.toBe(false);
    await expect(branchExists(repoRoot, 'feature/keep')).resolves.toBe(true);
    await expect(pathExists(detachedWorktreePath)).resolves.toBe(true);
  });

  it('removes a detached worktree without deleting any branch', async () => {
    // Given a repository root with a detached linked worktree.
    const repoRoot = await createRepository();
    const detachedWorktreePath = `${repoRoot}-detached`;
    await runGit(repoRoot, ['worktree', 'add', '--detach', detachedWorktreePath, 'HEAD']);
    const stdout: string[] = [];
    const runRemoveCommand = createRemoveCommand({
      confirmRemoval: async (worktree) => {
        expect(worktree.branch).toBeNull();
        expect(worktree.path).toBe(detachedWorktreePath);
        return true;
      },
      promptForWorktree: async (worktrees) => {
        expect(worktrees).toHaveLength(1);
        return detachedWorktreePath;
      },
    });

    // When gji remove selects that detached worktree.
    expect(await runRemoveCommand({
      cwd: repoRoot,
      stderr: () => undefined,
      stdout: (chunk) => stdout.push(chunk),
    })).toBe(0);

    // Then it removes only the worktree and prints the repository root.
    await expect(pathExists(detachedWorktreePath)).resolves.toBe(false);
    expect(stdout.join('').trim()).toBe(repoRoot);
  });

  it('writes the repository root to the shell output file without printing it', async () => {
    // Given a repository root with a linked branch worktree to remove and a shell output file.
    const repoRoot = await createRepository();
    const branch = 'feature/remove-output-file';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    const outputFile = `${repoRoot}-remove-output.txt`;
    const originalOutputFile = process.env.GJI_REMOVE_OUTPUT_FILE;
    const stdout: string[] = [];
    const runRemoveCommand = createRemoveCommand({
      confirmRemoval: async () => true,
    });

    process.env.GJI_REMOVE_OUTPUT_FILE = outputFile;

    try {
      // When gji remove runs via the shell-wrapper output file path.
      expect(await runRemoveCommand({
        branch,
        cwd: repoRoot,
        stderr: () => undefined,
        stdout: (chunk) => stdout.push(chunk),
      })).toBe(0);

      // Then it writes the repo root to the output file instead of stdout.
      await expect(pathExists(worktreePath)).resolves.toBe(false);
      expect(stdout).toEqual([]);
      await expect(readFile(outputFile, 'utf8')).resolves.toBe(`${repoRoot}\n`);
    } finally {
      if (originalOutputFile === undefined) {
        delete process.env.GJI_REMOVE_OUTPUT_FILE;
      } else {
        process.env.GJI_REMOVE_OUTPUT_FILE = originalOutputFile;
      }
    }
  });

  it('force-removes a worktree with untracked files when the user confirms', async () => {
    // Given a repository with a linked worktree that has an untracked file.
    const repoRoot = await createRepository();
    const branch = 'feature/remove-dirty-confirm';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    await writeFile(join(worktreePath, 'untracked.txt'), 'dirty');
    let promptedForForce = false;
    const runRemoveCommand = createRemoveCommand({
      confirmForceRemoveWorktree: async () => {
        promptedForForce = true;
        return true;
      },
      confirmRemoval: async () => true,
    });

    // When gji remove runs for that branch.
    expect(await runRemoveCommand({ branch, cwd: repoRoot, stderr: () => undefined, stdout: () => undefined })).toBe(0);

    // Then it force-removes the worktree after prompting.
    await expect(pathExists(worktreePath)).resolves.toBe(false);
    expect(promptedForForce).toBe(true);
  });

  it('aborts when a worktree has untracked files and force remove is declined', async () => {
    // Given a repository with a linked worktree that has an untracked file and a declined force prompt.
    const repoRoot = await createRepository();
    const branch = 'feature/remove-dirty-decline';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    await writeFile(join(worktreePath, 'untracked.txt'), 'dirty');
    const stderr: string[] = [];
    const runRemoveCommand = createRemoveCommand({
      confirmForceRemoveWorktree: async () => false,
      confirmRemoval: async () => true,
    });

    // When gji remove runs and force remove is declined.
    expect(await runRemoveCommand({ branch, cwd: repoRoot, stderr: (chunk) => stderr.push(chunk), stdout: () => undefined })).toBe(1);

    // Then it leaves the worktree intact and reports the abort.
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    expect(stderr.join('')).toContain('Aborted');
  });

  it('force-deletes an unmerged branch when the user confirms', async () => {
    // Given a repository with a linked worktree that has an unmerged commit.
    const repoRoot = await createRepository();
    const branch = 'feature/remove-unmerged-confirm';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    await commitFile(worktreePath, 'new.txt', 'content', 'Unmerged commit');
    let promptedForForce = false;
    const runRemoveCommand = createRemoveCommand({
      confirmForceDeleteBranch: async () => {
        promptedForForce = true;
        return true;
      },
      confirmRemoval: async () => true,
    });

    // When gji remove runs for that branch.
    expect(await runRemoveCommand({ branch, cwd: repoRoot, stderr: () => undefined, stdout: () => undefined })).toBe(0);

    // Then it force-deletes the branch after prompting.
    await expect(pathExists(worktreePath)).resolves.toBe(false);
    await expect(branchExists(repoRoot, branch)).resolves.toBe(false);
    expect(promptedForForce).toBe(true);
  });

  it('removes the worktree and keeps an unmerged branch when force delete is declined', async () => {
    // Given a repository with a linked worktree that has an unmerged commit and a declined force prompt.
    const repoRoot = await createRepository();
    const branch = 'feature/remove-unmerged-decline';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    await commitFile(worktreePath, 'new.txt', 'content', 'Unmerged commit');
    const runRemoveCommand = createRemoveCommand({
      confirmForceDeleteBranch: async () => false,
      confirmRemoval: async () => true,
    });

    // When gji remove runs and force delete is declined.
    expect(await runRemoveCommand({ branch, cwd: repoRoot, stderr: () => undefined, stdout: () => undefined })).toBe(0);

    // Then the worktree is removed but the branch is preserved.
    await expect(pathExists(worktreePath)).resolves.toBe(false);
    await expect(branchExists(repoRoot, branch)).resolves.toBe(true);
  });

  it('skips force prompts and force-removes worktree and force-deletes branch when force option is set', async () => {
    // Given a repository with a dirty linked worktree that has an unmerged commit.
    const repoRoot = await createRepository();
    const branch = 'feature/remove-force-flag';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    await writeFile(join(worktreePath, 'untracked.txt'), 'dirty');
    await commitFile(worktreePath, 'new.txt', 'content', 'Unmerged commit');
    const runRemoveCommand = createRemoveCommand({
      confirmForceDeleteBranch: async () => { throw new Error('should not prompt for force delete'); },
      confirmForceRemoveWorktree: async () => { throw new Error('should not prompt for force remove'); },
      confirmRemoval: async () => true,
    });

    // When gji remove runs with the force option.
    expect(await runRemoveCommand({ branch, cwd: repoRoot, force: true, stderr: () => undefined, stdout: () => undefined })).toBe(0);

    // Then it removes worktree and deletes branch without any force prompts.
    await expect(pathExists(worktreePath)).resolves.toBe(false);
    await expect(branchExists(repoRoot, branch)).resolves.toBe(false);
  });

  it('aborts cleanly when the interactive branch prompt is cancelled', async () => {
    // Given a repository root with a linked branch worktree and a cancelled chooser.
    const repoRoot = await createRepository();
    const branch = 'feature/remove-cancel';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    const stderr: string[] = [];
    const runRemoveCommand = createRemoveCommand({
      confirmRemoval: async () => {
        throw new Error('confirmRemoval should not run after a cancelled prompt');
      },
      promptForWorktree: async () => null,
    });

    // When gji remove runs without a branch and the chooser is cancelled.
    expect(await runRemoveCommand({
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
