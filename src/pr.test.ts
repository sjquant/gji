import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { resolveWorktreePath } from './repo.js';
import { createRepositoryWithOrigin } from './repo.test-helpers.js';

const execFileAsync = promisify(execFile);

describe('gji pr', () => {
  it('fetches a PR ref from origin and creates a linked worktree', async () => {
    // Given a repository with an origin remote exposing refs/pull/123/head.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branchName = 'feature/pr-source';
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/123');

    await execFileAsync('git', ['checkout', '-b', branchName], { cwd: repoRoot });
    await writeFile(join(repoRoot, 'pr-change.txt'), 'pr body\n', 'utf8');
    await execFileAsync('git', ['add', 'pr-change.txt'], { cwd: repoRoot });
    await execFileAsync('git', ['commit', '-m', 'pr source'], { cwd: repoRoot });
    await execFileAsync('git', ['push', 'origin', `HEAD:refs/pull/123/head`], {
      cwd: repoRoot,
    });
    await execFileAsync('git', ['checkout', '-'], { cwd: repoRoot });

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
    const existingWorktreePath = resolveWorktreePath(repoRoot, existingBranch);
    const prBranch = 'feature/pr-from-worktree';
    const prWorktreePath = resolveWorktreePath(repoRoot, 'pr/456');
    const nestedCwd = join(existingWorktreePath, 'nested');

    await execFileAsync('git', ['branch', existingBranch], { cwd: repoRoot });
    await execFileAsync('git', ['worktree', 'add', existingWorktreePath, existingBranch], {
      cwd: repoRoot,
    });

    await execFileAsync('git', ['checkout', '-b', prBranch], { cwd: repoRoot });
    await writeFile(join(repoRoot, 'pr-from-worktree.txt'), 'pr from worktree\n', 'utf8');
    await execFileAsync('git', ['add', 'pr-from-worktree.txt'], { cwd: repoRoot });
    await execFileAsync('git', ['commit', '-m', 'pr from worktree'], { cwd: repoRoot });
    await execFileAsync('git', ['push', 'origin', `HEAD:refs/pull/456/head`], {
      cwd: repoRoot,
    });
    await execFileAsync('git', ['checkout', '-'], { cwd: repoRoot });
    await mkdir(nestedCwd, { recursive: true });
    await writeFile(join(existingWorktreePath, 'nested', '.keep'), '', 'utf8');

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

async function currentBranch(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['branch', '--show-current'], { cwd });

  return stdout.trim();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
