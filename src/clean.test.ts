import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCleanCommand } from './clean.js';
import {
  addLinkedWorktree,
  commitFile,
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

  it('force-removes a dirty worktree when the user confirms', async () => {
    // Given a repository with a linked worktree that has an untracked file.
    const repoRoot = await createRepository();
    const branch = 'feature/clean-dirty-confirm';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    await writeFile(join(worktreePath, 'untracked.txt'), 'dirty');
    let promptedForForce = false;
    const runCleanCommand = createCleanCommand({
      confirmForceRemoveWorktree: async () => {
        promptedForForce = true;
        return true;
      },
      confirmRemoval: async () => true,
      promptForWorktrees: async () => [worktreePath],
    });

    // When gji clean runs.
    expect(await runCleanCommand({ cwd: repoRoot, stderr: () => undefined, stdout: () => undefined })).toBe(0);

    // Then it force-removes the worktree after prompting.
    await expect(pathExists(worktreePath)).resolves.toBe(false);
    expect(promptedForForce).toBe(true);
  });

  it('aborts when a dirty worktree force remove is declined', async () => {
    // Given a repository with a linked worktree that has an untracked file and a declined force prompt.
    const repoRoot = await createRepository();
    const branch = 'feature/clean-dirty-decline';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    await writeFile(join(worktreePath, 'untracked.txt'), 'dirty');
    const stderr: string[] = [];
    const runCleanCommand = createCleanCommand({
      confirmForceRemoveWorktree: async () => false,
      confirmRemoval: async () => true,
      promptForWorktrees: async () => [worktreePath],
    });

    // When gji clean runs and force remove is declined.
    expect(await runCleanCommand({ cwd: repoRoot, stderr: (chunk) => stderr.push(chunk), stdout: () => undefined })).toBe(1);

    // Then it leaves the worktree intact and reports the abort.
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    expect(stderr.join('')).toContain('Aborted');
  });

  it('force-deletes an unmerged branch when the user confirms', async () => {
    // Given a repository with a linked worktree that has an unmerged commit.
    const repoRoot = await createRepository();
    const branch = 'feature/clean-unmerged-confirm';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    await commitFile(worktreePath, 'new.txt', 'content', 'Unmerged commit');
    let promptedForForce = false;
    const runCleanCommand = createCleanCommand({
      confirmForceDeleteBranch: async () => {
        promptedForForce = true;
        return true;
      },
      confirmRemoval: async () => true,
      promptForWorktrees: async () => [worktreePath],
    });

    // When gji clean runs.
    expect(await runCleanCommand({ cwd: repoRoot, stderr: () => undefined, stdout: () => undefined })).toBe(0);

    // Then it force-deletes the branch after prompting.
    await expect(pathExists(worktreePath)).resolves.toBe(false);
    await expect(branchExists(repoRoot, branch)).resolves.toBe(false);
    expect(promptedForForce).toBe(true);
  });

  it('removes the worktree and keeps an unmerged branch when force delete is declined', async () => {
    // Given a repository with a linked worktree that has an unmerged commit and a declined force prompt.
    const repoRoot = await createRepository();
    const branch = 'feature/clean-unmerged-decline';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    await commitFile(worktreePath, 'new.txt', 'content', 'Unmerged commit');
    const stderr: string[] = [];
    const runCleanCommand = createCleanCommand({
      confirmForceDeleteBranch: async () => false,
      confirmRemoval: async () => true,
      promptForWorktrees: async () => [worktreePath],
    });

    // When gji clean runs and force delete is declined.
    expect(await runCleanCommand({ cwd: repoRoot, stderr: (chunk) => stderr.push(chunk), stdout: () => undefined })).toBe(0);

    // Then the worktree is removed but the branch is preserved, with a message about the kept branch.
    await expect(pathExists(worktreePath)).resolves.toBe(false);
    await expect(branchExists(repoRoot, branch)).resolves.toBe(true);
    expect(stderr.join('')).toContain(branch);
    expect(stderr.join('')).toContain('not deleted');
  });

  it('skips the initial confirmation prompt when force option is set', async () => {
    // Given a repository with a linked worktree and a confirmRemoval that would throw if called.
    const repoRoot = await createRepository();
    const branch = 'feature/clean-force-skips-confirm';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    const runCleanCommand = createCleanCommand({
      confirmRemoval: async () => { throw new Error('confirmRemoval should not be called with force'); },
      promptForWorktrees: async () => [worktreePath],
    });

    // When gji clean runs with force.
    expect(await runCleanCommand({ cwd: repoRoot, force: true, stderr: () => undefined, stdout: () => undefined })).toBe(0);

    // Then it removes the worktree without prompting for confirmation.
    await expect(pathExists(worktreePath)).resolves.toBe(false);
  });

  it('reports already-removed worktrees when aborting mid-batch due to a declined force remove', async () => {
    // Given a repository with two linked worktrees, the second having an untracked file.
    const repoRoot = await createRepository();
    const firstBranch = 'feature/clean-batch-first';
    const dirtyBranch = 'feature/clean-batch-dirty';
    const firstWorktreePath = await addLinkedWorktree(repoRoot, firstBranch);
    const dirtyWorktreePath = await addLinkedWorktree(repoRoot, dirtyBranch);
    await writeFile(join(dirtyWorktreePath, 'untracked.txt'), 'dirty');
    const stderr: string[] = [];
    const runCleanCommand = createCleanCommand({
      confirmForceRemoveWorktree: async () => false,
      confirmRemoval: async () => true,
      promptForWorktrees: async () => [firstWorktreePath, dirtyWorktreePath],
    });

    // When gji clean runs and force remove is declined for the second (dirty) worktree.
    expect(await runCleanCommand({ cwd: repoRoot, stderr: (chunk) => stderr.push(chunk), stdout: () => undefined })).toBe(1);

    // Then the first was removed, the second is kept, and stderr reports what was already done.
    await expect(pathExists(firstWorktreePath)).resolves.toBe(false);
    await expect(pathExists(dirtyWorktreePath)).resolves.toBe(true);
    const stderrOutput = stderr.join('');
    expect(stderrOutput).toContain(firstWorktreePath);
    expect(stderrOutput).toContain('Aborted');
  });

  it('skips force prompts when force option is set', async () => {
    // Given a repository with a dirty linked worktree that has an unmerged commit.
    const repoRoot = await createRepository();
    const branch = 'feature/clean-force-flag';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    await writeFile(join(worktreePath, 'untracked.txt'), 'dirty');
    await commitFile(worktreePath, 'new.txt', 'content', 'Unmerged commit');
    const runCleanCommand = createCleanCommand({
      confirmForceDeleteBranch: async () => { throw new Error('should not prompt for force delete'); },
      confirmForceRemoveWorktree: async () => { throw new Error('should not prompt for force remove'); },
      confirmRemoval: async () => true,
      promptForWorktrees: async () => [worktreePath],
    });

    // When gji clean runs with the force option.
    expect(await runCleanCommand({ cwd: repoRoot, force: true, stderr: () => undefined, stdout: () => undefined })).toBe(0);

    // Then it removes worktree and deletes branch without any force prompts.
    await expect(pathExists(worktreePath)).resolves.toBe(false);
    await expect(branchExists(repoRoot, branch)).resolves.toBe(false);
  });

  describe('--json output', () => {
    it('emits { removed: [{branch, path}] } to stdout on success', async () => {
      // Given a repository with two linked worktrees.
      const repoRoot = await createRepository();
      const branchA = 'feature/json-clean-a';
      const branchB = 'feature/json-clean-b';
      const pathA = await addLinkedWorktree(repoRoot, branchA);
      const pathB = await addLinkedWorktree(repoRoot, branchB);
      const stdout: string[] = [];
      const stderr: string[] = [];

      // When gji clean --json --force runs.
      const result = await createCleanCommand()({
        cwd: repoRoot,
        force: true,
        json: true,
        stderr: (chunk) => stderr.push(chunk),
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then it emits a JSON object listing the removed worktrees; nothing to stderr.
      expect(result).toBe(0);
      expect(stderr).toEqual([]);
      await expect(pathExists(pathA)).resolves.toBe(false);
      await expect(pathExists(pathB)).resolves.toBe(false);
      const output = JSON.parse(stdout.join(''));
      expect(output).toHaveProperty('removed');
      expect(output.removed).toHaveLength(2);
      expect(output.removed).toContainEqual({ branch: branchA, path: pathA });
      expect(output.removed).toContainEqual({ branch: branchB, path: pathB });
    });

    it('emits { error } to stderr and exits 1 when --force is not set', async () => {
      // Given a repository with a linked worktree.
      const repoRoot = await createRepository();
      await addLinkedWorktree(repoRoot, 'feature/json-clean-no-force');
      const stdout: string[] = [];
      const stderr: string[] = [];
      const runCleanCommand = createCleanCommand({
        promptForWorktrees: async () => { throw new Error('prompt must not be called in --json mode'); },
      });

      // When gji clean --json runs without --force.
      const result = await runCleanCommand({
        cwd: repoRoot,
        json: true,
        stderr: (chunk) => stderr.push(chunk),
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then it emits a JSON error and exits 1.
      expect(result).toBe(1);
      expect(stdout).toEqual([]);
      const json = JSON.parse(stderr.join(''));
      expect(json).toHaveProperty('error');
    });

    it('includes branch: null for removed detached worktrees', async () => {
      // Given a repository with a detached linked worktree.
      const repoRoot = await createRepository();
      const detachedWorktreePath = `${repoRoot}-json-clean-detached`;
      await runGit(repoRoot, ['worktree', 'add', '--detach', detachedWorktreePath, 'HEAD']);
      const stdout: string[] = [];

      // When gji clean --json --force runs.
      const result = await createCleanCommand()({
        cwd: repoRoot,
        force: true,
        json: true,
        stderr: () => undefined,
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then the removed array includes an entry with branch: null.
      expect(result).toBe(0);
      const output = JSON.parse(stdout.join(''));
      expect(output.removed).toContainEqual({ branch: null, path: detachedWorktreePath });
    });
  });
});

async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  return (await runGit(repoRoot, ['branch', '--list', branch])) !== '';
}
