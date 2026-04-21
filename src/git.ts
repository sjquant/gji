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
