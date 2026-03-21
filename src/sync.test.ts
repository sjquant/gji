import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import {
  addLinkedWorktree,
  cloneRepository,
  commitFile,
  createRepositoryWithOrigin,
  currentBranch,
  pathExists,
  runGit,
} from './repo.test-helpers.js';

describe('gji sync', () => {
  it('syncs the current linked worktree onto the latest default branch', async () => {
    // Given a repository with two linked worktrees behind the default branch.
    const { repoRoot } = await createRepositoryWithOrigin();
    const defaultBranch = await currentBranch(repoRoot);
    const targetBranch = 'feature/sync-current';
    const untouchedBranch = 'feature/stays-stale';
    const targetWorktreePath = await addLinkedWorktree(repoRoot, targetBranch);
    const untouchedWorktreePath = await addLinkedWorktree(repoRoot, untouchedBranch);
    const stdout: string[] = [];

    await commitFile(repoRoot, 'base-update.txt', 'base\n', 'base update');
    await runGit(repoRoot, ['push', 'origin', defaultBranch]);

    // When gji sync runs inside one linked worktree.
    const result = await runCli(['sync'], {
      cwd: targetWorktreePath,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it updates only that worktree onto the latest default branch.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(`${targetWorktreePath}\n`);
    await expect(pathExists(join(targetWorktreePath, 'base-update.txt'))).resolves.toBe(true);
    await expect(pathExists(join(untouchedWorktreePath, 'base-update.txt'))).resolves.toBe(false);
  });

  it('syncs every worktree when --all is provided', async () => {
    // Given a repository with linked worktrees behind the default branch.
    const { repoRoot } = await createRepositoryWithOrigin();
    const defaultBranch = await currentBranch(repoRoot);
    const firstBranch = 'feature/sync-all-one';
    const secondBranch = 'feature/sync-all-two';
    const firstWorktreePath = await addLinkedWorktree(repoRoot, firstBranch);
    const secondWorktreePath = await addLinkedWorktree(repoRoot, secondBranch);
    const stdout: string[] = [];

    await commitFile(repoRoot, 'all-update.txt', 'all\n', 'all update');
    await runGit(repoRoot, ['push', 'origin', defaultBranch]);

    // When gji sync runs in all-worktree mode.
    const result = await runCli(['sync', '--all'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it updates the repository root and every linked worktree.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(
      [repoRoot, firstWorktreePath, secondWorktreePath]
        .sort((left, right) => comparePaths(left, right))
        .map((path) => `${path}\n`)
        .join(''),
    );
    await expect(pathExists(join(firstWorktreePath, 'all-update.txt'))).resolves.toBe(true);
    await expect(pathExists(join(secondWorktreePath, 'all-update.txt'))).resolves.toBe(true);
  });

  it('refuses to sync a dirty worktree', async () => {
    // Given a repository with a dirty linked worktree.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branchName = 'feature/sync-dirty';
    const worktreePath = await addLinkedWorktree(repoRoot, branchName);
    const stderr: string[] = [];

    await writeFile(join(worktreePath, 'dirty.txt'), 'dirty\n', 'utf8');

    // When gji sync runs inside that dirty worktree.
    const result = await runCli(['sync'], {
      cwd: worktreePath,
      stderr: (chunk) => stderr.push(chunk),
    });

    // Then it aborts before attempting to sync.
    expect(result.exitCode).toBe(1);
    expect(stderr.join('')).toBe(`Cannot sync dirty worktree: ${worktreePath}\n`);
  });

  it('uses the remote default branch even when the repository root is on another branch', async () => {
    // Given a repository root checked out to a non-default branch.
    const { originRoot, repoRoot } = await createRepositoryWithOrigin();
    const defaultBranch = await currentBranch(repoRoot);
    const targetBranch = 'feature/sync-default-resolution';
    const targetWorktreePath = await addLinkedWorktree(repoRoot, targetBranch);
    const upstreamClone = await cloneRepository(originRoot);
    const stdout: string[] = [];

    await runGit(repoRoot, ['checkout', '-b', 'feature/root-current']);
    await commitFile(upstreamClone, 'remote-default.txt', 'remote default\n', 'remote default');
    await runGit(upstreamClone, ['push', 'origin', `HEAD:${defaultBranch}`]);

    // When gji sync runs in the linked worktree.
    const result = await runCli(['sync'], {
      cwd: targetWorktreePath,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it still rebases onto the remote default branch instead of the repo root branch.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(`${targetWorktreePath}\n`);
    await expect(pathExists(join(targetWorktreePath, 'remote-default.txt'))).resolves.toBe(true);
  });

  it('skips detached worktrees during sync --all', async () => {
    // Given a repository with one branch-backed worktree and one detached worktree.
    const { repoRoot } = await createRepositoryWithOrigin();
    const defaultBranch = await currentBranch(repoRoot);
    const featureBranch = 'feature/sync-skip-detached';
    const featureWorktreePath = await addLinkedWorktree(repoRoot, featureBranch);
    const detachedWorktreePath = `${repoRoot}-detached`;
    const stdout: string[] = [];

    await runGit(repoRoot, ['worktree', 'add', '--detach', detachedWorktreePath, 'HEAD']);
    await commitFile(repoRoot, 'skip-detached.txt', 'skip\n', 'skip detached');
    await runGit(repoRoot, ['push', 'origin', defaultBranch]);

    // When gji sync runs across every worktree.
    const result = await runCli(['sync', '--all'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it updates only branch-backed worktrees and skips the detached one.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(
      [repoRoot, featureWorktreePath]
        .sort((left, right) => comparePaths(left, right))
        .map((path) => `${path}\n`)
        .join(''),
    );
    await expect(pathExists(join(featureWorktreePath, 'skip-detached.txt'))).resolves.toBe(true);
    await expect(pathExists(join(detachedWorktreePath, 'skip-detached.txt'))).resolves.toBe(false);
  });

  it('refuses to sync when the current worktree is detached', async () => {
    // Given a detached worktree as the current working tree.
    const { repoRoot } = await createRepositoryWithOrigin();
    const detachedWorktreePath = `${repoRoot}-detached`;
    const stderr: string[] = [];

    await runGit(repoRoot, ['worktree', 'add', '--detach', detachedWorktreePath, 'HEAD']);

    // When gji sync runs inside that detached worktree.
    const result = await runCli(['sync'], {
      cwd: detachedWorktreePath,
      stderr: (chunk) => stderr.push(chunk),
    });

    // Then it aborts with a detached-worktree error.
    expect(result.exitCode).toBe(1);
    expect(stderr.join('')).toBe(`Cannot sync detached worktree: ${detachedWorktreePath}\n`);
  });

  it('uses repo-local sync config for remote and default-branch resolution', async () => {
    // Given a repository whose sync defaults are configured locally.
    const { repoRoot } = await createRepositoryWithOrigin();
    const defaultBranch = await currentBranch(repoRoot);
    const targetBranch = 'feature/sync-configured';
    const targetWorktreePath = await addLinkedWorktree(repoRoot, targetBranch);
    const stdout: string[] = [];

    await runGit(repoRoot, ['remote', 'rename', 'origin', 'upstream']);
    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({
        syncDefaultBranch: defaultBranch,
        syncRemote: 'upstream',
      }),
      'utf8',
    );
    await commitFile(repoRoot, 'configured-sync.txt', 'configured\n', 'configured sync');
    await runGit(repoRoot, ['push', 'upstream', defaultBranch]);

    // When gji sync runs inside the linked worktree.
    const result = await runCli(['sync'], {
      cwd: targetWorktreePath,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it uses the configured remote and default branch instead of the hard-coded defaults.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(`${targetWorktreePath}\n`);
    await expect(pathExists(join(targetWorktreePath, 'configured-sync.txt'))).resolves.toBe(true);
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
