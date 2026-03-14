import { execFile } from 'node:child_process';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RepositoryContext {
  currentRoot: string;
  gitCommonDir: string;
  isWorktree: boolean;
  repoName: string;
  repoRoot: string;
}

export interface WorktreeEntry {
  branch: string | null;
  path: string;
}

export async function detectRepository(cwd: string): Promise<RepositoryContext> {
  const currentRoot = await runGit(cwd, ['rev-parse', '--show-toplevel']);
  const rawCommonDir = await runGit(cwd, ['rev-parse', '--git-common-dir']);
  const gitCommonDir = isAbsolute(rawCommonDir)
    ? rawCommonDir
    : resolve(currentRoot, rawCommonDir);
  const repoRoot = dirname(gitCommonDir);

  return {
    currentRoot,
    gitCommonDir,
    isWorktree: currentRoot !== repoRoot,
    repoName: basename(repoRoot),
    repoRoot,
  };
}

export function resolveWorktreePath(repoRoot: string, branch: string): string {
  const segments = branch.split('/').filter(Boolean);

  if (segments.length === 0) {
    throw new Error('Branch name must not be empty.');
  }

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Branch name '${branch}' contains an invalid path segment.`);
  }

  return join(dirname(repoRoot), 'worktrees', basename(repoRoot), ...segments);
}

export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  const output = await runGit(cwd, ['worktree', 'list', '--porcelain']);
  const entries = output.split('\n\n').filter(Boolean);

  return entries.map((entry) => {
    const path = findPorcelainValue(entry, 'worktree');
    const branchRef = findOptionalPorcelainValue(entry, 'branch');

    return {
      branch: branchRef ? branchRef.replace('refs/heads/', '') : null,
      path,
    };
  });
}

function findPorcelainValue(block: string, key: string): string {
  const value = findOptionalPorcelainValue(block, key);

  if (!value) {
    throw new Error(`Missing '${key}' in git worktree output.`);
  }

  return value;
}

function findOptionalPorcelainValue(block: string, key: string): string | null {
  const line = block
    .split('\n')
    .find((candidate) => candidate.startsWith(`${key} `));

  if (!line) {
    return null;
  }

  return line.slice(key.length + 1);
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });

    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Git command failed in '${cwd}': ${message}`);
  }
}
