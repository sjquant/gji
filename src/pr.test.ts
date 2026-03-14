import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { resolveWorktreePath } from './repo.js';
import {
  addLinkedWorktree,
  commitFile,
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
});
