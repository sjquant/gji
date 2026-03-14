import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isCancel, select } from '@clack/prompts';

import { detectRepository, resolveWorktreePath } from './repo.js';

const execFileAsync = promisify(execFile);
export type PathConflictChoice = 'abort' | 'reuse';

export interface NewCommandOptions {
  branch: string;
  cwd: string;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export interface NewCommandDependencies {
  promptForPathConflict: (path: string) => Promise<PathConflictChoice>;
}

export function createNewCommand(
  dependencies: Partial<NewCommandDependencies> = {},
): (options: NewCommandOptions) => Promise<number> {
  const prompt = dependencies.promptForPathConflict ?? promptForPathConflict;

  return async function runNewCommand(options: NewCommandOptions): Promise<number> {
    const repository = await detectRepository(options.cwd);
    const worktreePath = resolveWorktreePath(repository.repoRoot, options.branch);

    if (await pathExists(worktreePath)) {
      const choice = await prompt(worktreePath);

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
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export const runNewCommand = createNewCommand();

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
