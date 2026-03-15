import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { detectRepository, listWorktrees, type WorktreeEntry } from './repo.js';

const execFileAsync = promisify(execFile);

export interface StatusCommandOptions {
  cwd: string;
  stdout: (chunk: string) => void;
}

interface WorktreeStatusRow {
  branch: string;
  current: boolean;
  path: string;
  status: 'clean' | 'dirty';
}

export async function runStatusCommand(options: StatusCommandOptions): Promise<number> {
  const repository = await detectRepository(options.cwd);
  const worktrees = await listWorktrees(options.cwd);
  const rows = await Promise.all(
    worktrees.map(async (worktree) => buildStatusRow(worktree, repository.currentRoot)),
  );

  options.stdout(`${formatStatusOutput(repository.repoRoot, repository.currentRoot, rows)}\n`);

  return 0;
}

export function formatStatusOutput(
  repoRoot: string,
  currentRoot: string,
  rows: WorktreeStatusRow[],
): string {
  const currentWidth = Math.max('CURRENT'.length, ...rows.map((row) => row.current ? 1 : 0));
  const branchWidth = Math.max('BRANCH'.length, ...rows.map((row) => row.branch.length));
  const statusWidth = Math.max('STATUS'.length, ...rows.map((row) => row.status.length));
  const lines = [
    `REPO ${repoRoot}`,
    `CURRENT ${currentRoot}`,
    '',
    `${'CURRENT'.padEnd(currentWidth, ' ')} ${'BRANCH'.padEnd(branchWidth, ' ')} ${'STATUS'.padEnd(statusWidth, ' ')} PATH`,
  ];

  for (const row of rows) {
    lines.push(
      `${(row.current ? '*' : '').padEnd(currentWidth, ' ')} ${row.branch.padEnd(branchWidth, ' ')} ${row.status.padEnd(statusWidth, ' ')} ${row.path}`,
    );
  }

  return lines.join('\n');
}

async function buildStatusRow(
  worktree: WorktreeEntry,
  currentRoot: string,
): Promise<WorktreeStatusRow> {
  return {
    branch: worktree.branch ?? '(detached)',
    current: worktree.path === currentRoot,
    path: worktree.path,
    status: (await isDirtyWorktree(worktree.path)) ? 'dirty' : 'clean',
  };
}

async function isDirtyWorktree(cwd: string): Promise<boolean> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd });

  return stdout.trim().length > 0;
}
