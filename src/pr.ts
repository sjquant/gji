import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { isCancel, select } from '@clack/prompts';

import { detectRepository, resolveWorktreePath } from './repo.js';
import { writeShellOutput } from './shell-handoff.js';

const execFileAsync = promisify(execFile);

export type PathConflictChoice = 'abort' | 'reuse';
const PR_OUTPUT_FILE_ENV = 'GJI_PR_OUTPUT_FILE';

export interface PrCommandOptions {
  cwd: string;
  number: string;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export interface PrCommandDependencies {
  promptForPathConflict: (path: string) => Promise<PathConflictChoice>;
}

export function createPrCommand(
  dependencies: Partial<PrCommandDependencies> = {},
): (options: PrCommandOptions) => Promise<number> {
  const prompt = dependencies.promptForPathConflict ?? promptForPathConflict;

  return async function runPrCommand(options: PrCommandOptions): Promise<number> {
    const repository = await detectRepository(options.cwd);
    const branchName = `pr/${options.number}`;
    const remoteRef = `refs/remotes/origin/pull/${options.number}/head`;
    const worktreePath = resolveWorktreePath(repository.repoRoot, branchName);

    if (await pathExists(worktreePath)) {
      const choice = await prompt(worktreePath);

      if (choice === 'reuse') {
        await writeOutput(worktreePath, options.stdout);
        return 0;
      }

      options.stderr(`Aborted because target worktree path already exists: ${worktreePath}\n`);
      return 1;
    }

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

    await writeOutput(worktreePath, options.stdout);

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

export const runPrCommand = createPrCommand();

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

async function writeOutput(
  worktreePath: string,
  stdout: (chunk: string) => void,
): Promise<void> {
  await writeShellOutput(PR_OUTPUT_FILE_ENV, worktreePath, stdout);
}
