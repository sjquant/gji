import { listWorktrees, type WorktreeEntry } from './repo.js';

export interface LsCommandOptions {
  cwd: string;
  stdout: (chunk: string) => void;
}

export async function runLsCommand(options: LsCommandOptions): Promise<number> {
  const worktrees = await listWorktrees(options.cwd);

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
