import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WorktreeHealth {
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  upstreamGone: boolean;
  status: 'clean' | 'dirty';
}

export async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });

    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Git command failed in '${cwd}': ${message}`);
  }
}

export async function readWorktreeHealth(cwd: string): Promise<WorktreeHealth> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain=v2', '--branch'], { cwd });

  return parseWorktreeHealth(stdout);
}

export async function isDirtyWorktree(cwd: string): Promise<boolean> {
  const health = await readWorktreeHealth(cwd);

  return health.status === 'dirty';
}

export async function isBranchMergedInto(cwd: string, branch: string, base = 'HEAD'): Promise<boolean> {
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', branch, base], { cwd });

    return true;
  } catch (error) {
    if (hasExitCode(error, 1)) {
      return false;
    }

    throw error;
  }
}

export async function resolveRemoteDefaultBranch(cwd: string, remote: string): Promise<string | null> {
  const { stdout } = await execFileAsync('git', ['ls-remote', '--symref', remote, 'HEAD'], { cwd });
  const refLine = stdout
    .split('\n')
    .find((line) => line.startsWith('ref: refs/heads/'));

  if (!refLine) {
    return null;
  }

  const match = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(refLine);

  return match?.[1] ?? null;
}

export async function readBranchLastCommitTimestamp(cwd: string, branch: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%ct', branch], { cwd });
    const timestamp = Number(stdout.trim());

    return Number.isFinite(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
}

function parseWorktreeHealth(output: string): WorktreeHealth {
  let ahead = 0;
  let behind = 0;
  let hasUpstream = false;
  let hasAb = false;
  let dirty = false;

  for (const line of output.split('\n').filter(Boolean)) {
    if (line.startsWith('# branch.upstream ')) {
      hasUpstream = true;
      continue;
    }

    if (line.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);

      if (!match) {
        throw new Error(`Unexpected branch.ab output: '${line}'`);
      }

      hasAb = true;
      ahead = Number(match[1]);
      behind = Number(match[2]);
      continue;
    }

    if (!line.startsWith('# ')) {
      dirty = true;
    }
  }

  return {
    ahead,
    behind,
    hasUpstream,
    upstreamGone: hasUpstream && !hasAb,
    status: dirty ? 'dirty' : 'clean',
  };
}

function hasExitCode(error: unknown, code: number): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as { code: unknown }).code === code;
}
