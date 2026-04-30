import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import {
  addLinkedWorktree,
  createRepository,
  currentBranch,
  runGit,
} from './repo.test-helpers.js';

describe('gji ls', () => {
  it('prints compact active worktrees as structured JSON with --compact --json', async () => {
    // Given a repository root with branch-backed worktrees.
    const repoRoot = await createRepository();
    const defaultBranch = await currentBranch(repoRoot);
    const featureBranch = 'feature/list-json';
    const bugfixBranch = 'bugfix/list-json';
    const featureWorktreePath = await addLinkedWorktree(repoRoot, featureBranch);
    const bugfixWorktreePath = await addLinkedWorktree(repoRoot, bugfixBranch);
    const stdout: string[] = [];

    // When gji ls runs in compact JSON mode.
    const result = await runCli(['ls', '--compact', '--json'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the worktrees as exact JSON data with the current worktree first.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(
      `${JSON.stringify([
        { branch: defaultBranch, isCurrent: true, path: repoRoot },
        { branch: bugfixBranch, isCurrent: false, path: bugfixWorktreePath },
        { branch: featureBranch, isCurrent: false, path: featureWorktreePath },
      ], null, 2)}\n`,
    );
  });

  it('prints active worktrees in a compact readable table with --compact', async () => {
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

    // When gji ls --compact runs from the repository root.
    const result = await runCli(['ls', '--compact'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    const lines = stdout.join('').trimEnd().split('\n');
    const branchWidth = Math.max(
      'BRANCH'.length,
      defaultBranch.length,
      ...branchNames.map((branch) => branch.length),
    );
    // Current worktree (repoRoot) is listed first; others are sorted by path.
    const sortedOthers = [...worktrees].sort((left, right) => comparePaths(left.path, right.path));
    const expected = [
      `  ${'BRANCH'.padEnd(branchWidth, ' ')} PATH`,
      `* ${defaultBranch.padEnd(branchWidth, ' ')} ${repoRoot}`,
      ...sortedOthers.map((worktree) => `  ${worktree.branch.padEnd(branchWidth, ' ')} ${worktree.path}`),
    ];

    // Then it prints every active worktree in a branch/path table, current first with a * marker.
    expect(result.exitCode).toBe(0);
    expect(lines).toEqual(expected);
  });

  it('prints status, upstream, and last commit columns by default', async () => {
    // Given a repository root with one clean worktree and one dirty worktree.
    const repoRoot = await createRepository();
    const defaultBranch = await currentBranch(repoRoot);
    const cleanBranch = 'feature/list-details-clean';
    const dirtyBranch = 'feature/list-details-dirty';
    const cleanWorktreePath = await addLinkedWorktree(repoRoot, cleanBranch);
    const dirtyWorktreePath = await addLinkedWorktree(repoRoot, dirtyBranch);
    const stdout: string[] = [];
    await writeFile(join(dirtyWorktreePath, 'dirty.txt'), 'dirty\n', 'utf8');

    // When gji ls runs from the repository root.
    const result = await runCli(['ls'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    const output = stdout.join('');

    // Then it prints cleanup-oriented health details without hiding the paths.
    expect(result.exitCode).toBe(0);
    expect(output).toContain('BRANCH');
    expect(output).toContain('STATUS');
    expect(output).toContain('UPSTREAM');
    expect(output).toContain('LAST');
    expect(output).toContain(`* ${defaultBranch}`);
    expect(output).toContain(`  ${cleanBranch}`);
    expect(output).toContain(`  ${dirtyBranch}`);
    expect(output).toContain('clean');
    expect(output).toContain('dirty');
    expect(output).toContain('no-upstream');
    expect(output).toContain('just now');
    expect(output).toContain(cleanWorktreePath);
    expect(output).toContain(dirtyWorktreePath);
  });

  it('prints detailed worktree health as JSON by default when --json is used', async () => {
    // Given a repository root with a linked worktree.
    const repoRoot = await createRepository();
    const defaultBranch = await currentBranch(repoRoot);
    const featureBranch = 'feature/list-details-json';
    const featureWorktreePath = await addLinkedWorktree(repoRoot, featureBranch);
    const stdout: string[] = [];

    // When gji ls --json runs.
    const result = await runCli(['ls', '--json'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    const json = JSON.parse(stdout.join(''));

    // Then the JSON includes the same health details used by detailed text output.
    expect(result.exitCode).toBe(0);
    expect(json).toHaveLength(2);
    expect(json[0]).toMatchObject({
      branch: defaultBranch,
      isCurrent: true,
      path: repoRoot,
      status: 'clean',
      upstream: { kind: 'no-upstream' },
    });
    expect(json[0].lastCommitTimestamp).toEqual(expect.any(Number));
    expect(json[1]).toMatchObject({
      branch: featureBranch,
      isCurrent: false,
      path: featureWorktreePath,
      status: 'clean',
      upstream: { kind: 'no-upstream' },
    });
    expect(json[1].lastCommitTimestamp).toEqual(expect.any(Number));
  });

  it('labels detached worktrees explicitly', async () => {
    // Given a repository root with both branch-backed and detached linked worktrees.
    const repoRoot = await createRepository();
    const featureBranch = 'feature/for-detached-list';
    const featureWorktreePath = await addLinkedWorktree(repoRoot, featureBranch);
    const detachedWorktreePath = `${repoRoot}-detached`;
    const stdout: string[] = [];

    await runGit(repoRoot, ['worktree', 'add', '--detach', detachedWorktreePath, 'HEAD']);

    // When gji ls --compact runs from the repository root.
    const result = await runCli(['ls', '--compact'], {
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
    // repoRoot is current; others sorted by path: detachedWorktreePath < featureWorktreePath.
    const sortedOthers = [
      { branch: '(detached)', path: detachedWorktreePath },
      { branch: featureBranch, path: featureWorktreePath },
    ].sort((left, right) => comparePaths(left.path, right.path));
    const expected = [
      `  ${'BRANCH'.padEnd(branchWidth, ' ')} PATH`,
      `* ${defaultBranch.padEnd(branchWidth, ' ')} ${repoRoot}`,
      ...sortedOthers.map((worktree) => `  ${worktree.branch.padEnd(branchWidth, ' ')} ${worktree.path}`),
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

    // When gji ls runs in compact JSON mode.
    const result = await runCli(['ls', '--compact', '--json'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it preserves the detached entry with a null branch value, current worktree first.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(
      `${JSON.stringify([
        { branch: defaultBranch, isCurrent: true, path: repoRoot },
        { branch: null, isCurrent: false, path: detachedWorktreePath },
        { branch: featureBranch, isCurrent: false, path: featureWorktreePath },
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

    // When gji ls runs in compact JSON mode from inside that linked worktree.
    const result = await runCli(['ls', '--compact', '--json'], {
      cwd: featureWorktreePath,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the repository-wide worktree list with the current worktree first.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(
      `${JSON.stringify([
        { branch: featureBranch, isCurrent: true, path: featureWorktreePath },
        { branch: defaultBranch, isCurrent: false, path: repoRoot },
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
