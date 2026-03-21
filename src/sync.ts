import { loadEffectiveConfig } from './config.js';
import { isDirtyWorktree, runGit } from './git.js';
import { comparePaths } from './paths.js';
import { detectRepository, listWorktrees, type WorktreeEntry } from './repo.js';

export interface SyncCommandOptions {
  all?: boolean;
  cwd: string;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export async function runSyncCommand(options: SyncCommandOptions): Promise<number> {
  const repository = await detectRepository(options.cwd);
  const config = await loadEffectiveConfig(repository.repoRoot);
  const worktrees = await listWorktrees(options.cwd);
  const remote = resolveConfiguredString(config.syncRemote) ?? 'origin';
  const defaultBranch = resolveConfiguredString(config.syncDefaultBranch)
    ?? await resolveDefaultBranch(repository.repoRoot, remote);

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

  await runGit(repository.repoRoot, ['fetch', '--prune', remote]);

  for (const worktree of targetWorktrees) {
    if (worktree.branch === defaultBranch) {
      await runGit(worktree.path, ['merge', '--ff-only', `${remote}/${defaultBranch}`]);
    } else {
      await runGit(worktree.path, ['rebase', `${remote}/${defaultBranch}`]);
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
      .sort((left, right) => comparePaths(left.path, right.path));
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

async function resolveDefaultBranch(repoRoot: string, remote: string): Promise<string | null> {
  const stdout = await runGit(repoRoot, ['ls-remote', '--symref', remote, 'HEAD']);
  const refLine = stdout
    .split('\n')
    .find((line) => line.startsWith('ref: refs/heads/'));

  if (!refLine) {
    return null;
  }

  const match = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(refLine);

  return match?.[1] ?? null;
}

function resolveConfiguredString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
