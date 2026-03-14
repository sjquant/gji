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
    const worktrees = await Promise.all(
      branchNames.map(async (branch) => ({
        branch,
        path: await addLinkedWorktree(repoRoot, branch),
      })),
    );
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

    // Then it prints every active worktree in a branch/path table.
    expect(result.exitCode).toBe(0);
    expect(lines).toHaveLength(worktrees.length + 2);
    expect(lines[0]).toBe(`${'BRANCH'.padEnd(branchWidth, ' ')} PATH`);
    expect(lines[1]).toBe(`${defaultBranch.padEnd(branchWidth, ' ')} ${repoRoot}`);
    expect(lines.slice(2)).toEqual(
      expect.arrayContaining(
        worktrees.map(
          (worktree) => `${worktree.branch.padEnd(branchWidth, ' ')} ${worktree.path}`,
        ),
      ),
    );
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
    const branchWidth = Math.max(
      'BRANCH'.length,
      featureBranch.length,
      '(detached)'.length,
    );
    const output = stdout.join('');

    // Then it keeps the branch-backed worktree and labels the detached one clearly.
    expect(result.exitCode).toBe(0);
    expect(output).toContain(
      `${featureBranch.padEnd(branchWidth, ' ')} ${featureWorktreePath}`,
    );
    expect(output).toContain(
      `${'(detached)'.padEnd(branchWidth, ' ')} ${detachedWorktreePath}`,
    );
  });
});
