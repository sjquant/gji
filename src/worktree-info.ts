import { readBranchLastCommitTimestamp, readWorktreeHealth, type WorktreeHealth } from './git.js';
import type { WorktreeEntry } from './repo.js';

export interface WorktreeInfo extends WorktreeEntry {
  lastCommitTimestamp: number | null;
  status: WorktreeHealth['status'] | 'unknown';
  upstream: UpstreamState;
}

export interface SerializedWorktreeInfo {
  branch: string | null;
  lastCommitTimestamp: number | null;
  path: string;
  status: WorktreeInfo['status'];
  upstream: UpstreamState;
}

export type UpstreamState =
  | { kind: 'detached' }
  | { kind: 'no-upstream' }
  | { kind: 'stale' }
  | { kind: 'tracked'; ahead: number; behind: number }
  | { kind: 'unknown' };

export async function readWorktreeInfos(worktrees: WorktreeEntry[]): Promise<WorktreeInfo[]> {
  return Promise.all(worktrees.map((worktree) => readWorktreeInfo(worktree)));
}

async function readWorktreeInfo(worktree: WorktreeEntry): Promise<WorktreeInfo> {
  const [healthResult, lastCommitResult] = await Promise.allSettled([
    readWorktreeHealth(worktree.path),
    worktree.branch === null ? null : readBranchLastCommitTimestamp(worktree.path, worktree.branch),
  ]);
  const health = healthResult.status === 'fulfilled' ? healthResult.value : null;
  const lastCommitTimestamp = lastCommitResult.status === 'fulfilled'
    ? lastCommitResult.value
    : null;

  return {
    ...worktree,
    lastCommitTimestamp,
    status: health?.status ?? 'unknown',
    upstream: buildUpstreamState(worktree.branch, health),
  };
}

function buildUpstreamState(branch: string | null, health: WorktreeHealth | null): UpstreamState {
  if (branch === null) {
    return { kind: 'detached' };
  }

  if (health === null) {
    return { kind: 'unknown' };
  }

  if (!health.hasUpstream) {
    return { kind: 'no-upstream' };
  }

  if (health.upstreamGone) {
    return { kind: 'stale' };
  }

  return {
    ahead: health.ahead,
    behind: health.behind,
    kind: 'tracked',
  };
}

export function serializeWorktreeInfo(info: WorktreeInfo): SerializedWorktreeInfo {
  return {
    branch: info.branch,
    lastCommitTimestamp: info.lastCommitTimestamp,
    path: info.path,
    status: info.status,
    upstream: info.upstream,
  };
}

export function formatWorktreeHint(info: WorktreeInfo): string {
  const details = [
    `status: ${info.status}`,
    `upstream: ${formatUpstreamState(info.upstream)}`,
  ];

  if (info.lastCommitTimestamp !== null) {
    details.push(`last: ${formatRelativeAge(info.lastCommitTimestamp)}`);
  }

  return `${info.path} (${details.join(', ')})`;
}

export function formatUpstreamState(upstream: UpstreamState): string {
  if (upstream.kind === 'detached') {
    return 'n/a';
  }

  if (upstream.kind === 'no-upstream') {
    return 'no-upstream';
  }

  if (upstream.kind === 'stale') {
    return 'gone';
  }

  if (upstream.kind === 'unknown') {
    return 'unknown';
  }

  return formatAheadBehind(upstream.ahead, upstream.behind);
}

function formatAheadBehind(ahead: number, behind: number): string {
  if (ahead === 0 && behind === 0) {
    return 'up to date';
  }

  if (ahead === 0) {
    return `behind ${behind}`;
  }

  if (behind === 0) {
    return `ahead ${ahead}`;
  }

  return `ahead ${ahead}, behind ${behind}`;
}

export function formatLastCommit(timestampSeconds: number | null): string {
  return timestampSeconds === null ? 'n/a' : formatRelativeAge(timestampSeconds);
}

export function formatRelativeAge(timestampSeconds: number): string {
  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - timestampSeconds);
  const units = [
    { label: 'y', seconds: 365 * 24 * 60 * 60 },
    { label: 'mo', seconds: 30 * 24 * 60 * 60 },
    { label: 'd', seconds: 24 * 60 * 60 },
    { label: 'h', seconds: 60 * 60 },
    { label: 'm', seconds: 60 },
  ];

  for (const unit of units) {
    const value = Math.floor(ageSeconds / unit.seconds);

    if (value > 0) {
      return `${value}${unit.label} ago`;
    }
  }

  return 'just now';
}
