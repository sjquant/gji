import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import {
  addLinkedWorktree,
  commitFile,
  createRepository,
  createRepositoryWithOrigin,
  cloneRepository,
  currentBranch,
  runGit,
} from './repo.test-helpers.js';

describe('gji status', () => {
  it('prints repository metadata and worktree health from the repository root', async () => {
    // Given a repository root with one clean worktree and one dirty worktree.
    const repoRoot = await createRepository();
    const defaultBranch = await currentBranch(repoRoot);
    const cleanBranch = 'feature/status-clean';
    const dirtyBranch = 'feature/status-dirty';
    const cleanWorktreePath = await addLinkedWorktree(repoRoot, cleanBranch);
    const dirtyWorktreePath = await addLinkedWorktree(repoRoot, dirtyBranch);
    const stdout: string[] = [];

    await writeFile(join(dirtyWorktreePath, 'dirty.txt'), 'dirty\n', 'utf8');

    // When gji status runs from the repository root.
    const result = await runCli(['status'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the repository metadata and per-worktree health table.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(
      buildExpectedStatusOutput({
        currentRoot: repoRoot,
        repoRoot,
        rows: [
          {
            branch: defaultBranch,
            current: true,
            path: repoRoot,
            status: 'clean',
            upstream: 'no-upstream',
          },
          {
            branch: cleanBranch,
            current: false,
            path: cleanWorktreePath,
            status: 'clean',
            upstream: 'no-upstream',
          },
          {
            branch: dirtyBranch,
            current: false,
            path: dirtyWorktreePath,
            status: 'dirty',
            upstream: 'no-upstream',
          },
        ],
      }),
    );
  });

  it('marks the current linked worktree when run inside that worktree', async () => {
    // Given a repository with a linked worktree as the current working tree.
    const repoRoot = await createRepository();
    const defaultBranch = await currentBranch(repoRoot);
    const branchName = 'feature/status-current';
    const worktreePath = await addLinkedWorktree(repoRoot, branchName);
    const stdout: string[] = [];

    // When gji status runs from that linked worktree.
    const result = await runCli(['status'], {
      cwd: worktreePath,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it reports the repository root and marks the current linked worktree.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(
      buildExpectedStatusOutput({
        currentRoot: worktreePath,
        repoRoot,
        rows: [
          {
            branch: defaultBranch,
            current: false,
            path: repoRoot,
            status: 'clean',
            upstream: 'no-upstream',
          },
          {
            branch: branchName,
            current: true,
            path: worktreePath,
            status: 'clean',
            upstream: 'no-upstream',
          },
        ],
      }),
    );
  });

  it('shows ahead and behind counts for branch-backed worktrees with upstreams', async () => {
    // Given a repository with one branch behind upstream and another ahead of upstream.
    const { originRoot, repoRoot } = await createRepositoryWithOrigin();
    const defaultBranch = await currentBranch(repoRoot);
    const aheadBranch = 'feature/status-ahead';
    const aheadWorktreePath = await addLinkedWorktree(repoRoot, aheadBranch);
    const stdout: string[] = [];
    const upstreamClone = await cloneRepository(originRoot);

    await runGit(repoRoot, ['push', '-u', 'origin', aheadBranch]);
    await commitFile(aheadWorktreePath, 'ahead.txt', 'ahead\n', 'ahead');
    await commitFile(upstreamClone, 'behind.txt', 'behind\n', 'behind');
    await runGit(upstreamClone, ['push', 'origin', `HEAD:${defaultBranch}`]);
    await runGit(repoRoot, ['fetch', 'origin']);

    // When gji status runs from the repository root.
    const result = await runCli(['status'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it reports upstream divergence counts for tracked branches.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(
      buildExpectedStatusOutput({
        currentRoot: repoRoot,
        repoRoot,
        rows: [
          {
            branch: defaultBranch,
            current: true,
            path: repoRoot,
            status: 'clean',
            upstream: 'behind 1',
          },
          {
            branch: aheadBranch,
            current: false,
            path: aheadWorktreePath,
            status: 'clean',
            upstream: 'ahead 1',
          },
        ],
      }),
    );
  });

  it('prints n/a as the upstream state for detached worktrees', async () => {
    // Given a repository with a detached linked worktree.
    const repoRoot = await createRepository();
    const defaultBranch = await currentBranch(repoRoot);
    const detachedWorktreePath = `${repoRoot}-detached`;
    const stdout: string[] = [];

    await runGit(repoRoot, ['worktree', 'add', '--detach', detachedWorktreePath, 'HEAD']);

    // When gji status runs from the repository root.
    const result = await runCli(['status'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it renders detached worktrees with an n/a upstream state.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(
      buildExpectedStatusOutput({
        currentRoot: repoRoot,
        repoRoot,
        rows: [
          {
            branch: defaultBranch,
            current: true,
            path: repoRoot,
            status: 'clean',
            upstream: 'no-upstream',
          },
          {
            branch: null,
            current: false,
            path: detachedWorktreePath,
            status: 'clean',
            upstream: 'n/a',
          },
        ],
      }),
    );
  });

  it('prints stable structured JSON with repository metadata and upstream state', async () => {
    // Given a repository with tracked, untracked, and detached worktrees.
    const { originRoot, repoRoot } = await createRepositoryWithOrigin();
    const defaultBranch = await currentBranch(repoRoot);
    const trackedBranch = 'feature/status-json-tracked';
    const untrackedBranch = 'feature/status-json-untracked';
    const trackedWorktreePath = await addLinkedWorktree(repoRoot, trackedBranch);
    const untrackedWorktreePath = await addLinkedWorktree(repoRoot, untrackedBranch);
    const detachedWorktreePath = `${repoRoot}-detached`;
    const upstreamClone = await cloneRepository(originRoot);
    const stdout: string[] = [];

    await runGit(repoRoot, ['push', '-u', 'origin', trackedBranch]);
    await commitFile(trackedWorktreePath, 'ahead.txt', 'ahead\n', 'ahead');
    await commitFile(upstreamClone, 'behind.txt', 'behind\n', 'behind');
    await runGit(upstreamClone, ['push', 'origin', `HEAD:${defaultBranch}`]);
    await runGit(repoRoot, ['fetch', 'origin']);
    await runGit(repoRoot, ['worktree', 'add', '--detach', detachedWorktreePath, 'HEAD']);
    await writeFile(join(untrackedWorktreePath, 'dirty.txt'), 'dirty\n', 'utf8');

    // When gji status runs in JSON mode.
    const result = await runCli(['status', '--json'], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints exact structured repository and worktree status data.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(
      `${JSON.stringify({
        currentRoot: repoRoot,
        repoRoot,
        worktrees: [
          {
            branch: defaultBranch,
            current: true,
            path: repoRoot,
            status: 'clean',
            upstream: { ahead: 0, behind: 1, kind: 'tracked' },
          },
          {
            branch: null,
            current: false,
            path: detachedWorktreePath,
            status: 'clean',
            upstream: { kind: 'detached' },
          },
          {
            branch: trackedBranch,
            current: false,
            path: trackedWorktreePath,
            status: 'clean',
            upstream: { ahead: 1, behind: 0, kind: 'tracked' },
          },
          {
            branch: untrackedBranch,
            current: false,
            path: untrackedWorktreePath,
            status: 'dirty',
            upstream: { kind: 'no-upstream' },
          },
        ],
      }, null, 2)}\n`,
    );
  });
});

function buildExpectedStatusOutput(input: {
  currentRoot: string;
  repoRoot: string;
  rows: Array<{
    branch: string | null;
    current: boolean;
    path: string;
    status: 'clean' | 'dirty';
    upstream: string;
  }>;
}): string {
  const currentWidth = 'CURRENT'.length;
  const branchWidth = Math.max(
    'BRANCH'.length,
    ...input.rows.map((row) => formatBranch(row.branch).length),
  );
  const statusWidth = Math.max(
    'STATUS'.length,
    ...input.rows.map((row) => row.status.length),
  );
  const upstreamWidth = Math.max(
    'UPSTREAM'.length,
    ...input.rows.map((row) => row.upstream.length),
  );

  return [
    `REPO ${input.repoRoot}`,
    `CURRENT ${input.currentRoot}`,
    '',
    `${'CURRENT'.padEnd(currentWidth, ' ')} ${'BRANCH'.padEnd(branchWidth, ' ')} ${'STATUS'.padEnd(statusWidth, ' ')} ${'UPSTREAM'.padEnd(upstreamWidth, ' ')} PATH`,
    ...input.rows.map(
      (row) =>
        `${(row.current ? '*' : '').padEnd(currentWidth, ' ')} ${formatBranch(row.branch).padEnd(branchWidth, ' ')} ${row.status.padEnd(statusWidth, ' ')} ${row.upstream.padEnd(upstreamWidth, ' ')} ${row.path}`,
    ),
    '',
  ].join('\n');
}

function formatBranch(branch: string | null): string {
  return branch ?? '(detached)';
}
