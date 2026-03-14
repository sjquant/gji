import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { detectRepository, resolveWorktreePath } from './repo.js';

const execFileAsync = promisify(execFile);

export interface PrCommandOptions {
  cwd: string;
  number: string;
  stdout: (chunk: string) => void;
}

export async function runPrCommand(options: PrCommandOptions): Promise<number> {
  const repository = await detectRepository(options.cwd);
  const branchName = `pr/${options.number}`;
  const remoteRef = `refs/remotes/origin/pull/${options.number}/head`;
  const worktreePath = resolveWorktreePath(repository.repoRoot, branchName);

  await execFileAsync(
    'git',
    ['fetch', 'origin', `refs/pull/${options.number}/head:${remoteRef}`],
    { cwd: repository.repoRoot },
  );
  await mkdir(dirname(worktreePath), { recursive: true });
  await execFileAsync(
    'git',
    ['worktree', 'add', '-b', branchName, worktreePath, remoteRef],
    { cwd: repository.repoRoot },
  );

  options.stdout(`${worktreePath}\n`);

  return 0;
}
