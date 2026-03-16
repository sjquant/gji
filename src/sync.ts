import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { detectRepository, listWorktrees, type WorktreeEntry } from './repo.js';

const execFileAsync = promisify(execFile);

export interface SyncCommandOptions {
  all?: boolean;
  cwd: string;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export async function runSyncCommand(options: SyncCommandOptions): Promise<number> {
  const repository = await detectRepository(options.cwd);
  const worktrees = await listWorktrees(options.cwd);
  const defaultBranch = await resolveDefaultBranch(repository.repoRoot);

  if (!defaultBranch) {
    options.stderr('Unable to determine the default branch for sync.\n');
    return 1;
  }

  const targetWorktrees = selectTargetWorktrees(worktrees, repository.currentRoot, options.all);

  if (targetWorktrees === 'detached') {
    options.stderr(`Cannot sync detached worktree: ${repository.currentRoot}\n`);
    return 1;
  }

  for (const worktree of targetWorktrees) {
    if (await isDirtyWorktree(worktree.path)) {
      options.stderr(`Cannot sync dirty worktree: ${worktree.path}\n`);
      return 1;
    }
  }

  await execFileAsync('git', ['fetch', '--prune', 'origin'], { cwd: repository.repoRoot });

  for (const worktree of targetWorktrees) {
    if (worktree.branch === defaultBranch) {
      await execFileAsync(
        'git',
        ['merge', '--ff-only', `origin/${defaultBranch}`],
        { cwd: worktree.path },
      );
    } else {
      await execFileAsync('git', ['rebase', `origin/${defaultBranch}`], {
        cwd: worktree.path,
      });
    }

    options.stdout(`${worktree.path}\n`);
  }

  return 0;
}

function selectTargetWorktrees(
  worktrees: WorktreeEntry[],
  currentRoot: string,
  all: boolean | undefined,
): WorktreeEntry[] | 'detached' {
  if (all) {
    return worktrees
      .filter((worktree) => worktree.branch !== null)
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  const currentWorktree = worktrees.find((worktree) => worktree.path === currentRoot);

  if (!currentWorktree) {
    return [];
  }

  if (!currentWorktree.branch) {
    return 'detached';
  }

  return [currentWorktree];
}

async function isDirtyWorktree(cwd: string): Promise<boolean> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd });

  return stdout.trim().length > 0;
}

async function resolveDefaultBranch(repoRoot: string): Promise<string | null> {
  const { stdout } = await execFileAsync('git', ['ls-remote', '--symref', 'origin', 'HEAD'], {
    cwd: repoRoot,
  });
  const refLine = stdout
    .split('\n')
    .find((line) => line.startsWith('ref: refs/heads/'));

  if (!refLine) {
    return null;
  }

  const match = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(refLine);

  return match?.[1] ?? null;
}
