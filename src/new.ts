import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isCancel, select } from '@clack/prompts';

import { detectRepository, resolveWorktreePath } from './repo.js';

const execFileAsync = promisify(execFile);
type PathConflictChoice = 'abort' | 'reuse';

export interface NewCommandOptions {
  branch: string;
  choosePathConflict?: (path: string) => Promise<PathConflictChoice>;
  cwd: string;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export async function runNewCommand(options: NewCommandOptions): Promise<number> {
  const repository = await detectRepository(options.cwd);
  const worktreePath = resolveWorktreePath(repository.repoRoot, options.branch);

  if (await pathExists(worktreePath)) {
    const choice = await (options.choosePathConflict ?? promptForPathConflict)(worktreePath);

    if (choice === 'reuse') {
      options.stdout(`${worktreePath}\n`);
      return 0;
    }

    options.stderr(`Aborted because target worktree path already exists: ${worktreePath}\n`);
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

async function promptForPathConflict(path: string): Promise<PathConflictChoice> {
  const choice = await select<PathConflictChoice>({
    message: `Target path already exists: ${path}`,
    options: [
      { value: 'abort', label: 'Abort', hint: 'Keep the existing directory untouched' },
      { value: 'reuse', label: 'Reuse path', hint: 'Print the existing path and stop' },
    ],
  });

  if (isCancel(choice)) {
    return 'abort';
  }

  return choice;
}
