import { listWorktrees, type WorktreeEntry } from './repo.js';

export interface LsCommandOptions {
  cwd: string;
  json?: boolean;
  stdout: (chunk: string) => void;
}

export async function runLsCommand(options: LsCommandOptions): Promise<number> {
  const worktrees = sortWorktreesByPath(await listWorktrees(options.cwd));

  if (options.json) {
    options.stdout(`${JSON.stringify(worktrees, null, 2)}\n`);
    return 0;
  }

  options.stdout(`${formatWorktreeTable(worktrees)}\n`);

  return 0;
}

export function formatWorktreeTable(worktrees: WorktreeEntry[]): string {
  const rows = worktrees.map((worktree) => ({
    branch: worktree.branch ?? '(detached)',
    path: worktree.path,
  }));
  const branchWidth = Math.max(
    'BRANCH'.length,
    ...rows.map((row) => row.branch.length),
  );
  const lines = ['BRANCH'.padEnd(branchWidth, ' ') + ' PATH'];

  for (const row of rows) {
    lines.push(`${row.branch.padEnd(branchWidth, ' ')} ${row.path}`);
  }

  return lines.join('\n');
}

function sortWorktreesByPath(worktrees: WorktreeEntry[]): WorktreeEntry[] {
  return [...worktrees].sort((left, right) => comparePaths(left.path, right.path));
}

function comparePaths(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
