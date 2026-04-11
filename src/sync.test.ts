import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import {
  addLinkedWorktree,
  cloneRepository,
  commitFile,
  createRepository,
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

describe('gji sync --json', () => {
  it('emits { updated } to stdout on success', async () => {
    // Given a repository with a linked worktree behind the default branch.
    const { repoRoot } = await createRepositoryWithOrigin();
    const defaultBranch = await currentBranch(repoRoot);
    const featureBranch = 'feature/json-sync-success';
    const worktreePath = await addLinkedWorktree(repoRoot, featureBranch);
    const stdout: string[] = [];
    const stderr: string[] = [];

    await commitFile(repoRoot, 'json-sync.txt', 'updated\n', 'json sync update');
    await runGit(repoRoot, ['push', 'origin', defaultBranch]);

    // When gji sync --json runs inside the linked worktree.
    const result = await runCli(['sync', '--json'], {
      cwd: worktreePath,
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it emits JSON with updated array; nothing to stderr.
    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const output = JSON.parse(stdout.join(''));
    expect(output).toHaveProperty('updated');
    expect(output.updated).toHaveLength(1);
    expect(output.updated[0]).toEqual({ branch: featureBranch, path: worktreePath });
  });

  it('emits { updated } for all worktrees with --all --json', async () => {
    // Given a repository with two linked worktrees behind the default branch.
    const { repoRoot } = await createRepositoryWithOrigin();
    const defaultBranch = await currentBranch(repoRoot);
    const firstBranch = 'feature/json-all-one';
    const secondBranch = 'feature/json-all-two';
    const firstPath = await addLinkedWorktree(repoRoot, firstBranch);
    const secondPath = await addLinkedWorktree(repoRoot, secondBranch);
    const stdout: string[] = [];
    const stderr: string[] = [];

    await commitFile(repoRoot, 'json-all.txt', 'all\n', 'json all update');
    await runGit(repoRoot, ['push', 'origin', defaultBranch]);

    // When gji sync --all --json runs from the repo root.
    const result = await runCli(['sync', '--all', '--json'], {
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it emits a single JSON object listing all updated worktrees.
    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const output = JSON.parse(stdout.join(''));
    expect(output).toHaveProperty('updated');
    const paths = output.updated.map((w: { path: string }) => w.path).sort();
    expect(paths).toEqual([repoRoot, firstPath, secondPath].sort());
  });

  it('emits { error } to stderr and exits 1 when the worktree is dirty', async () => {
    // Given a repository with a dirty linked worktree.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branchName = 'feature/json-sync-dirty';
    const worktreePath = await addLinkedWorktree(repoRoot, branchName);
    const stdout: string[] = [];
    const stderr: string[] = [];

    await writeFile(join(worktreePath, 'dirty.txt'), 'dirty\n', 'utf8');

    // When gji sync --json runs inside that dirty worktree.
    const result = await runCli(['sync', '--json'], {
      cwd: worktreePath,
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it emits a JSON error and exits 1.
    expect(result.exitCode).toBe(1);
    expect(stdout).toEqual([]);
    const json = JSON.parse(stderr.join(''));
    expect(json).toHaveProperty('error');
    expect(typeof json.error).toBe('string');
  });

  it('emits { error } to stderr and exits 1 when the worktree is detached', async () => {
    // Given a detached worktree as the current working tree.
    const { repoRoot } = await createRepositoryWithOrigin();
    const detachedPath = `${repoRoot}-json-detached`;
    const stdout: string[] = [];
    const stderr: string[] = [];

    await runGit(repoRoot, ['worktree', 'add', '--detach', detachedPath, 'HEAD']);

    // When gji sync --json runs inside that detached worktree.
    const result = await runCli(['sync', '--json'], {
      cwd: detachedPath,
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it emits a JSON error and exits 1.
    expect(result.exitCode).toBe(1);
    expect(stdout).toEqual([]);
    const json = JSON.parse(stderr.join(''));
    expect(json).toHaveProperty('error');
    expect(typeof json.error).toBe('string');
  });
});

describe('gji sync Hint: lines', () => {
  it('emits a Hint: line when the remote is unreachable (text mode)', async () => {
    // Given a repository without any remote configured.
    const repoRoot = await createRepository();
    const stderr: string[] = [];

    // When gji sync runs with no remote.
    const result = await runCli(['sync'], {
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    // Then it exits 1 and emits a Hint: line suggesting how to add the remote.
    expect(result.exitCode).toBe(1);
    const stderrText = stderr.join('');
    expect(stderrText).toContain('Hint:');
    expect(stderrText).toContain('git remote add');
  });

  it('does NOT emit a Hint: line in --json mode when the remote is unreachable', async () => {
    // Given a repository without any remote configured.
    const repoRoot = await createRepository();
    const stderr: string[] = [];

    // When gji sync --json runs with no remote.
    const result = await runCli(['sync', '--json'], {
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    // Then it exits 1 with a valid JSON error and no Hint: text mixed in.
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(stderr.join(''));
    expect(json).toHaveProperty('error');
    expect(stderr.join('')).not.toContain('Hint:');
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
