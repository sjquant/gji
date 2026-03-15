import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { addLinkedWorktree, createRepository, currentBranch } from './repo.test-helpers.js';

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
          { branch: defaultBranch, current: true, path: repoRoot, status: 'clean' },
          { branch: cleanBranch, current: false, path: cleanWorktreePath, status: 'clean' },
          { branch: dirtyBranch, current: false, path: dirtyWorktreePath, status: 'dirty' },
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
          { branch: defaultBranch, current: false, path: repoRoot, status: 'clean' },
          { branch: branchName, current: true, path: worktreePath, status: 'clean' },
        ],
      }),
    );
  });
});

function buildExpectedStatusOutput(input: {
  currentRoot: string;
  repoRoot: string;
  rows: Array<{
    branch: string;
    current: boolean;
    path: string;
    status: 'clean' | 'dirty';
  }>;
}): string {
  const currentWidth = 'CURRENT'.length;
  const branchWidth = Math.max(
    'BRANCH'.length,
    ...input.rows.map((row) => row.branch.length),
  );
  const statusWidth = Math.max(
    'STATUS'.length,
    ...input.rows.map((row) => row.status.length),
  );

  return [
    `REPO ${input.repoRoot}`,
    `CURRENT ${input.currentRoot}`,
    '',
    `${'CURRENT'.padEnd(currentWidth, ' ')} ${'BRANCH'.padEnd(branchWidth, ' ')} ${'STATUS'.padEnd(statusWidth, ' ')} PATH`,
    ...input.rows.map(
      (row) =>
        `${(row.current ? '*' : '').padEnd(currentWidth, ' ')} ${row.branch.padEnd(branchWidth, ' ')} ${row.status.padEnd(statusWidth, ' ')} ${row.path}`,
    ),
    '',
  ].join('\n');
}
