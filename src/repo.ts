import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { runGit } from './git.js';

export interface RepositoryContext {
  currentRoot: string;
  gitCommonDir: string;
  isWorktree: boolean;
  repoName: string;
  repoRoot: string;
}

export interface WorktreeEntry {
  branch: string | null;
  isCurrent: boolean;
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

export function resolveWorktreePath(repoRoot: string, branch: string, basePath?: string): string {
  const segments = branch.split('/').filter(Boolean);

  if (segments.length === 0) {
    throw new Error('Branch name must not be empty.');
  }

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Branch name '${branch}' contains an invalid path segment.`);
  }

  const base = basePath
    ? expandTildeInPath(basePath)
    : join(dirname(repoRoot), 'worktrees', basename(repoRoot));

  return join(base, ...segments);
}

export function validateBranchName(name: string): string | null {
  if (name.length === 0) {
    return 'Branch name must not be empty.';
  }
  if (/[\x00-\x1f\x7f ~^:?*[\\\s]/.test(name)) {
    return `Branch name '${name}' contains an invalid character.`;
  }
  if (name.startsWith('-')) {
    return `Branch name '${name}' must not start with a dash.`;
  }
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) {
    return `Branch name '${name}' has invalid slash placement.`;
  }
  if (name.includes('..')) {
    return `Branch name '${name}' must not contain '..'.`;
  }
  if (name.endsWith('.')) {
    return `Branch name '${name}' must not end with '.'.`;
  }
  if (name.includes('@{')) {
    return `Branch name '${name}' must not contain '@{'.`;
  }
  if (name === '@') {
    return "Branch name cannot be '@'.";
  }
  for (const segment of name.split('/')) {
    if (segment.startsWith('.')) {
      return `Branch name '${name}' contains a path component starting with '.'.`;
    }
    if (segment.endsWith('.lock')) {
      return `Branch name '${name}' contains a path component ending with '.lock'.`;
    }
  }
  return null;
}

function expandTildeInPath(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  const [output, currentRoot] = await Promise.all([
    runGit(cwd, ['worktree', 'list', '--porcelain']),
    runGit(cwd, ['rev-parse', '--show-toplevel']),
  ]);
  const entries = output.split('\n\n').filter(Boolean);

  return entries.map((entry) => {
    const path = findPorcelainValue(entry, 'worktree');
    const branchRef = findOptionalPorcelainValue(entry, 'branch');

    return {
      branch: branchRef ? branchRef.replace('refs/heads/', '') : null,
      isCurrent: path === currentRoot,
      path,
    };
  });
}

export function sortByCurrentFirst(worktrees: WorktreeEntry[]): WorktreeEntry[] {
  return [...worktrees].sort((a, b) => {
    if (a.isCurrent && !b.isCurrent) return -1;
    if (!a.isCurrent && b.isCurrent) return 1;
    return 0;
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
