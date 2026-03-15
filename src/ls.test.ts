import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import {
  addLinkedWorktree,
  createRepository,
  currentBranch,
  runGit,
} from './repo.test-helpers.js';

describe('gji ls', () => {
  it('prints active worktrees in a readable table', async () => {
    // Given a repository root with several linked worktrees.
    const repoRoot = await createRepository();
    const defaultBranch = await currentBranch(repoRoot);
    const branchNames = [
      'feature/list-worktrees',
      'bugfix/short',
      'chore/a-very-long-branch-name',
    ];
    const worktrees: Array<{ branch: string; path: string }> = [];

    for (const branch of branchNames) {
      worktrees.push({
        branch,
        path: await addLinkedWorktree(repoRoot, branch),
      });
    }
    const stdout: string[] = [];

    // When gji ls runs from the repository root.
    const result = await runCli(['ls'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    const lines = stdout.join('').trimEnd().split('\n');
    const branchWidth = Math.max(
      'BRANCH'.length,
      defaultBranch.length,
      ...branchNames.map((branch) => branch.length),
    );
    const expected = [
      `${'BRANCH'.padEnd(branchWidth, ' ')} PATH`,
      ...[
        { branch: defaultBranch, path: repoRoot },
        ...worktrees,
      ]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((worktree) => `${worktree.branch.padEnd(branchWidth, ' ')} ${worktree.path}`),
    ];

    // Then it prints every active worktree in a branch/path table.
    expect(result.exitCode).toBe(0);
    expect(lines).toEqual(expected);
  });

  it('labels detached worktrees explicitly', async () => {
    // Given a repository root with both branch-backed and detached linked worktrees.
    const repoRoot = await createRepository();
    const featureBranch = 'feature/for-detached-list';
    const featureWorktreePath = await addLinkedWorktree(repoRoot, featureBranch);
    const detachedWorktreePath = `${repoRoot}-detached`;
    const stdout: string[] = [];

    await runGit(repoRoot, ['worktree', 'add', '--detach', detachedWorktreePath, 'HEAD']);

    // When gji ls runs from the repository root.
    const result = await runCli(['ls'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });
    const defaultBranch = await currentBranch(repoRoot);
    const branchWidth = Math.max(
      'BRANCH'.length,
      defaultBranch.length,
      featureBranch.length,
      '(detached)'.length,
    );
    const expected = [
      `${'BRANCH'.padEnd(branchWidth, ' ')} PATH`,
      ...[
        { branch: defaultBranch, path: repoRoot },
        { branch: featureBranch, path: featureWorktreePath },
        { branch: '(detached)', path: detachedWorktreePath },
      ]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((worktree) => `${worktree.branch.padEnd(branchWidth, ' ')} ${worktree.path}`),
    ].join('\n');

    // Then it keeps the branch-backed worktree and labels the detached one clearly.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('').trimEnd()).toBe(expected);
  });
});
