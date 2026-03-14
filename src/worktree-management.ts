import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { detectRepository, listWorktrees, type RepositoryContext, type WorktreeEntry } from './repo.js';

const execFileAsync = promisify(execFile);

export interface LinkedWorktreeContext {
  linkedWorktrees: WorktreeEntry[];
  repository: RepositoryContext;
}

export async function loadLinkedWorktrees(cwd: string): Promise<LinkedWorktreeContext> {
  const repository = await detectRepository(cwd);
  const linkedWorktrees = (await listWorktrees(cwd)).filter(
    (worktree) => worktree.path !== repository.repoRoot,
  );

  return {
    linkedWorktrees,
    repository,
  };
}

export async function removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
  await execFileAsync('git', ['worktree', 'remove', worktreePath], { cwd: repoRoot });
}

export async function deleteBranch(repoRoot: string, branch: string): Promise<void> {
  await execFileAsync('git', ['branch', '-d', branch], { cwd: repoRoot });
}
