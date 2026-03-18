import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import {
  addLinkedWorktree,
  createRepository,
  currentBranch,
  runGit,
} from './repo.test-helpers.js';

describe('gji ls', () => {
  it('prints active worktrees as structured JSON with --json', async () => {
    // Given a repository root with branch-backed worktrees.
    const repoRoot = await createRepository();
    const defaultBranch = await currentBranch(repoRoot);
    const featureBranch = 'feature/list-json';
    const bugfixBranch = 'bugfix/list-json';
    const featureWorktreePath = await addLinkedWorktree(repoRoot, featureBranch);
    const bugfixWorktreePath = await addLinkedWorktree(repoRoot, bugfixBranch);
    const stdout: string[] = [];

    // When gji ls runs in JSON mode.
    const result = await runCli(['ls', '--json'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the worktrees as exact JSON data.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(
      `${JSON.stringify([
        { branch: defaultBranch, path: repoRoot },
        { branch: bugfixBranch, path: bugfixWorktreePath },
        { branch: featureBranch, path: featureWorktreePath },
      ], null, 2)}\n`,
    );
  });

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
        .sort((left, right) => comparePaths(left.path, right.path))
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
        .sort((left, right) => comparePaths(left.path, right.path))
        .map((worktree) => `${worktree.branch.padEnd(branchWidth, ' ')} ${worktree.path}`),
    ].join('\n');

    // Then it keeps the branch-backed worktree and labels the detached one clearly.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('').trimEnd()).toBe(expected);
  });

  it('keeps detached worktrees as branch:null in JSON mode', async () => {
    // Given a repository root with both branch-backed and detached linked worktrees.
    const repoRoot = await createRepository();
    const defaultBranch = await currentBranch(repoRoot);
    const featureBranch = 'feature/list-json-detached';
    const featureWorktreePath = await addLinkedWorktree(repoRoot, featureBranch);
    const detachedWorktreePath = `${repoRoot}-detached`;
    const stdout: string[] = [];

    await runGit(repoRoot, ['worktree', 'add', '--detach', detachedWorktreePath, 'HEAD']);

    // When gji ls runs in JSON mode.
    const result = await runCli(['ls', '--json'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it preserves the detached entry with a null branch value.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(
      `${JSON.stringify([
        { branch: defaultBranch, path: repoRoot },
        { branch: null, path: detachedWorktreePath },
        { branch: featureBranch, path: featureWorktreePath },
      ], null, 2)}\n`,
    );
  });

  it('prints the same JSON output when run from inside a linked worktree', async () => {
    // Given a repository with a linked worktree as the current working tree.
    const repoRoot = await createRepository();
    const defaultBranch = await currentBranch(repoRoot);
    const featureBranch = 'feature/list-json-from-worktree';
    const featureWorktreePath = await addLinkedWorktree(repoRoot, featureBranch);
    const stdout: string[] = [];

    // When gji ls runs in JSON mode from inside that linked worktree.
    const result = await runCli(['ls', '--json'], {
      cwd: featureWorktreePath,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the repository-wide worktree list, not only the current entry.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(
      `${JSON.stringify([
        { branch: defaultBranch, path: repoRoot },
        { branch: featureBranch, path: featureWorktreePath },
      ], null, 2)}\n`,
    );
  });
});

function comparePaths(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
