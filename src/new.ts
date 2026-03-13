import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { detectRepository, resolveWorktreePath } from './repo.js';

const execFileAsync = promisify(execFile);

export interface NewCommandOptions {
  branch: string;
  cwd: string;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export async function runNewCommand(options: NewCommandOptions): Promise<number> {
  const repository = await detectRepository(options.cwd);
  const worktreePath = resolveWorktreePath(repository.repoRoot, options.branch);

  if (await pathExists(worktreePath)) {
    options.stderr(`Target worktree path already exists: ${worktreePath}\n`);
    return 1;
  }

  await mkdir(dirname(worktreePath), { recursive: true });
  await execFileAsync(
    'git',
    ['worktree', 'add', '-b', options.branch, worktreePath],
    { cwd: repository.repoRoot },
  );

  options.stdout(`${worktreePath}\n`);

  return 0;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
