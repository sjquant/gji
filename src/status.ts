import { detectRepository, listWorktrees, type WorktreeEntry } from './repo.js';
import { readWorktreeHealth, type WorktreeHealth } from './git.js';

export interface StatusCommandOptions {
  cwd: string;
  stdout: (chunk: string) => void;
}

interface WorktreeStatusRow {
  branch: string;
  current: boolean;
  path: string;
  status: 'clean' | 'dirty';
  upstream: UpstreamState;
}

type UpstreamState =
  | { kind: 'detached' }
  | { kind: 'no-upstream' }
  | { kind: 'tracked'; ahead: number; behind: number };

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
  const upstreamWidth = Math.max(
    'UPSTREAM'.length,
    ...rows.map((row) => formatUpstreamState(row.upstream).length),
  );
  const lines = [
    `REPO ${repoRoot}`,
    `CURRENT ${currentRoot}`,
    '',
    `${'CURRENT'.padEnd(currentWidth, ' ')} ${'BRANCH'.padEnd(branchWidth, ' ')} ${'STATUS'.padEnd(statusWidth, ' ')} ${'UPSTREAM'.padEnd(upstreamWidth, ' ')} PATH`,
  ];

  for (const row of rows) {
    lines.push(
      `${(row.current ? '*' : '').padEnd(currentWidth, ' ')} ${row.branch.padEnd(branchWidth, ' ')} ${row.status.padEnd(statusWidth, ' ')} ${formatUpstreamState(row.upstream).padEnd(upstreamWidth, ' ')} ${row.path}`,
    );
  }

  return lines.join('\n');
}

async function buildStatusRow(
  worktree: WorktreeEntry,
  currentRoot: string,
): Promise<WorktreeStatusRow> {
  const health = await readWorktreeHealth(worktree.path);

  return {
    branch: worktree.branch ?? '(detached)',
    current: worktree.path === currentRoot,
    path: worktree.path,
    status: health.status,
    upstream: buildUpstreamState(worktree.branch, health),
  };
}

function buildUpstreamState(branch: string | null, health: WorktreeHealth): UpstreamState {
  if (branch === null) {
    return { kind: 'detached' };
  }

  if (!health.hasUpstream) {
    return { kind: 'no-upstream' };
  }

  return {
    ahead: health.ahead,
    behind: health.behind,
    kind: 'tracked',
  };
}

function formatUpstreamState(upstream: UpstreamState): string {
  if (upstream.kind === 'detached') {
    return 'n/a';
  }

  if (upstream.kind === 'no-upstream') {
    return 'no-upstream';
  }

  if (upstream.ahead === 0 && upstream.behind === 0) {
    return 'up to date';
  }

  if (upstream.ahead === 0) {
    return `behind ${upstream.behind}`;
  }

  if (upstream.behind === 0) {
    return `ahead ${upstream.ahead}`;
  }

  return `ahead ${upstream.ahead}, behind ${upstream.behind}`;
}
