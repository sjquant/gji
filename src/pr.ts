import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { type PathConflictChoice, pathExists, promptForPathConflict } from './conflict.js';
import { detectRepository, resolveWorktreePath } from './repo.js';
import { writeShellOutput } from './shell-handoff.js';

const execFileAsync = promisify(execFile);

export type { PathConflictChoice };
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

export function parsePrInput(input: string): string | null {
  if (/^\d+$/.test(input)) return input;

  const hashMatch = input.match(/^#(\d+)$/);
  if (hashMatch) return hashMatch[1];

  const urlMatch = input.match(/\/(?:pull|pull-requests|merge_requests)\/(\d+)/);
  if (urlMatch) return urlMatch[1];

  return null;
}

export function createPrCommand(
  dependencies: Partial<PrCommandDependencies> = {},
): (options: PrCommandOptions) => Promise<number> {
  const prompt = dependencies.promptForPathConflict ?? promptForPathConflict;

  return async function runPrCommand(options: PrCommandOptions): Promise<number> {
    const prNumber = parsePrInput(options.number);

    if (!prNumber) {
      options.stderr(`Invalid PR reference: ${options.number}\n`);
      return 1;
    }

    const repository = await detectRepository(options.cwd);
    const branchName = `pr/${prNumber}`;
    const remoteRef = `refs/remotes/origin/pull/${prNumber}/head`;
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

    try {
      await execFileAsync(
        'git',
        ['fetch', 'origin', `refs/pull/${prNumber}/head:${remoteRef}`],
        { cwd: repository.repoRoot },
      );
    } catch {
      options.stderr(`Failed to fetch PR #${prNumber} from origin\n`);
      return 1;
    }

    await mkdir(dirname(worktreePath), { recursive: true });

    const branchAlreadyExists = await localBranchExists(repository.repoRoot, branchName);
    const worktreeArgs = branchAlreadyExists
      ? ['worktree', 'add', worktreePath, branchName]
      : ['worktree', 'add', '-b', branchName, worktreePath, remoteRef];

    await execFileAsync('git', worktreeArgs, { cwd: repository.repoRoot });

    await writeOutput(worktreePath, options.stdout);

    return 0;
  };
}

async function localBranchExists(repoRoot: string, branchName: string): Promise<boolean> {
  try {
    await execFileAsync(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`],
      { cwd: repoRoot },
    );
    return true;
  } catch {
    return false;
  }
}

export const runPrCommand = createPrCommand();

async function writeOutput(
  worktreePath: string,
  stdout: (chunk: string) => void,
): Promise<void> {
  await writeShellOutput(PR_OUTPUT_FILE_ENV, worktreePath, stdout);
}
