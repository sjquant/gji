import { mkdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { loadEffectiveConfig } from './config.js';
import { syncFiles } from './file-sync.js';
import { type PathConflictChoice, pathExists, promptForPathConflict } from './conflict.js';
import { extractHooks, runHook } from './hooks.js';
import { isHeadless } from './headless.js';
import { type InstallPromptDependencies, maybeRunInstallPrompt } from './install-prompt.js';
import { detectRepository, resolveWorktreePath } from './repo.js';
import { writeShellOutput } from './shell-handoff.js';

const execFileAsync = promisify(execFile);

export type { PathConflictChoice };
const PR_OUTPUT_FILE_ENV = 'GJI_PR_OUTPUT_FILE';

export interface PrCommandOptions {
  cwd: string;
  json?: boolean;
  number: string;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export interface PrCommandDependencies extends InstallPromptDependencies {
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
      const message = `Invalid PR reference: ${options.number}`;
      if (options.json) {
        options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
      } else {
        options.stderr(`${message}\n`);
      }
      return 1;
    }

    const repository = await detectRepository(options.cwd);
    const config = await loadEffectiveConfig(repository.repoRoot);
    const branchName = `pr/${prNumber}`;
    const remoteRef = `refs/remotes/origin/pull/${prNumber}/head`;
    const worktreePath = resolveWorktreePath(repository.repoRoot, branchName);

    if (await pathExists(worktreePath)) {
      if (options.json || isHeadless()) {
        const message = `target worktree path already exists: ${worktreePath}`;
        if (options.json) {
          options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
        } else {
          options.stderr(`gji pr: ${message} in non-interactive mode (GJI_NO_TUI=1)\n`);
        }
        return 1;
      }

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
      const message = `Failed to fetch PR #${prNumber} from origin`;
      if (options.json) {
        options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
      } else {
        options.stderr(`${message}\n`);
      }
      return 1;
    }

    await mkdir(dirname(worktreePath), { recursive: true });

    const branchAlreadyExists = await localBranchExists(repository.repoRoot, branchName);
    const worktreeArgs = branchAlreadyExists
      ? ['worktree', 'add', worktreePath, branchName]
      : ['worktree', 'add', '-b', branchName, worktreePath, remoteRef];

    await execFileAsync('git', worktreeArgs, { cwd: repository.repoRoot });

    // Sync files from main worktree before afterCreate so synced files are available to install scripts.
    const syncPatterns = Array.isArray(config.syncFiles)
      ? (config.syncFiles as unknown[]).filter((p): p is string => typeof p === 'string')
      : [];
    for (const pattern of syncPatterns) {
      try {
        await syncFiles(repository.repoRoot, worktreePath, [pattern]);
      } catch (error) {
        options.stderr(`Warning: failed to sync file "${pattern}": ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }

    await maybeRunInstallPrompt(worktreePath, repository.repoRoot, config, options.stderr, dependencies, !!options.json);

    const hooks = extractHooks(config);
    await runHook(
      hooks.afterCreate,
      worktreePath,
      { branch: branchName, path: worktreePath, repo: basename(repository.repoRoot) },
      options.stderr,
    );

    if (options.json) {
      options.stdout(`${JSON.stringify({ branch: branchName, path: worktreePath }, null, 2)}\n`);
    } else {
      await writeOutput(worktreePath, options.stdout);
    }

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
