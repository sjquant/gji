import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { detectRepository, resolveWorktreePath } from './repo.js';

const execFileAsync = promisify(execFile);

describe('detectRepository', () => {
  it('finds the main repository root from the repository root', async () => {
    const repoRoot = await createRepository();

    const result = await detectRepository(repoRoot);

    expect(result).toMatchObject({
      currentRoot: repoRoot,
      isWorktree: false,
      repoName: 'gji-detect-main',
      repoRoot,
    });
  });

  it('finds the main repository root from a nested linked worktree path', async () => {
    const repoRoot = await createRepository();
    const branchName = 'feature/nested-path';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);

    await runGit(repoRoot, ['branch', branchName]);
    await runGit(repoRoot, ['worktree', 'add', worktreePath, branchName]);
    await mkdir(join(worktreePath, 'deep', 'inside'), { recursive: true });
    const realWorktreePath = await realpath(worktreePath);

    const result = await detectRepository(join(worktreePath, 'deep', 'inside'));

    expect(result).toMatchObject({
      currentRoot: realWorktreePath,
      isWorktree: true,
      repoName: 'gji-detect-main',
      repoRoot,
    });
  });
});

describe('resolveWorktreePath', () => {
  it('uses the ../worktrees/{repo}/{branch} layout', () => {
    expect(resolveWorktreePath('/tmp/repos/gji', 'feature/test-branch')).toBe(
      '/tmp/repos/worktrees/gji/feature/test-branch',
    );
  });
});

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gji-detect-main-'));
  const repoRoot = join(root, 'gji-detect-main');

  await mkdir(repoRoot, { recursive: true });
  await writeFile(join(repoRoot, 'README.md'), '# temp repo\n', 'utf8');
  await runGit(repoRoot, ['init']);
  await runGit(repoRoot, ['config', 'user.name', 'Codex']);
  await runGit(repoRoot, ['config', 'user.email', 'codex@example.com']);
  await runGit(repoRoot, ['add', 'README.md']);
  await runGit(repoRoot, ['commit', '-m', 'init']);

  return realpath(repoRoot);
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}
