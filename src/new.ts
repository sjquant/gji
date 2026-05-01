import { mkdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isCancel, text } from '@clack/prompts';

import { loadEffectiveConfig, resolveConfigString } from './config.js';
import { syncFiles } from './file-sync.js';
import { extractHooks, runHook } from './hooks.js';
import { appendHistory } from './history.js';
import { isHeadless } from './headless.js';
import { type InstallPromptDependencies, maybeRunInstallPrompt } from './install-prompt.js';
import { type PathConflictChoice, pathExists, promptForPathConflict } from './conflict.js';
import { detectRepository, resolveWorktreePath, validateBranchName } from './repo.js';
import { writeShellOutput } from './shell-handoff.js';

const execFileAsync = promisify(execFile);
export type { PathConflictChoice };
const NEW_OUTPUT_FILE_ENV = 'GJI_NEW_OUTPUT_FILE';

export interface NewCommandOptions {
  branch?: string;
  cwd: string;
  detached?: boolean;
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export interface NewCommandDependencies extends InstallPromptDependencies {
  createBranchPlaceholder: () => string;
  promptForBranch: (placeholder: string) => Promise<string | null>;
  promptForPathConflict: (path: string) => Promise<PathConflictChoice>;
}

export function createNewCommand(
  dependencies: Partial<NewCommandDependencies> = {},
): (options: NewCommandOptions) => Promise<number> {
  const createBranchPlaceholder = dependencies.createBranchPlaceholder ?? generateBranchPlaceholder;
  const promptForBranch = dependencies.promptForBranch ?? defaultPromptForBranch;
  const prompt = dependencies.promptForPathConflict ?? promptForPathConflict;

  return async function runNewCommand(options: NewCommandOptions): Promise<number> {
    const repository = await detectRepository(options.cwd);
    const config = await loadEffectiveConfig(repository.repoRoot, undefined, options.stderr);
    const usesGeneratedDetachedName = options.detached && options.branch === undefined;

    if (!options.detached && !options.branch && (options.json || isHeadless())) {
      const message = 'branch argument is required';
      if (options.json) {
        options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
      } else {
        options.stderr(`gji new: ${message} in non-interactive mode (GJI_NO_TUI=1)\n`);
      }
      return 1;
    }

    const rawBranch = options.detached
      ? options.branch ?? createBranchPlaceholder()
      : options.branch ?? await promptForBranch(createBranchPlaceholder());

    if (!rawBranch) {
      if (options.json) {
        options.stderr(`${JSON.stringify({ error: 'Aborted' }, null, 2)}\n`);
      } else {
        options.stderr('Aborted\n');
      }
      return 1;
    }

    if (!options.detached) {
      const branchError = validateBranchName(rawBranch);
      if (branchError) {
        if (options.json) {
          options.stderr(`${JSON.stringify({ error: branchError }, null, 2)}\n`);
        } else {
          options.stderr(`gji new: ${branchError}\n`);
        }
        return 1;
      }
    }

    const rawBasePath = resolveConfigString(config, 'worktreePath');
    const configuredBasePath =
      rawBasePath?.startsWith('/') || rawBasePath?.startsWith('~') ? rawBasePath : undefined;
    const worktreeName = options.detached
      ? rawBranch
      : applyConfiguredBranchPrefix(rawBranch, config.branchPrefix);
    const worktreePath = usesGeneratedDetachedName
      ? await resolveUniqueDetachedWorktreePath(repository.repoRoot, worktreeName, configuredBasePath)
      : resolveWorktreePath(repository.repoRoot, worktreeName, configuredBasePath);

    if (!usesGeneratedDetachedName && await pathExists(worktreePath)) {
      if (options.force) {
        if (!options.dryRun) {
          try {
            await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repository.repoRoot });
          } catch (err) {
            if (!isNotRegisteredWorktreeError(err)) {
              const msg = `could not remove existing worktree at ${worktreePath}: ${toExecMessage(err)}`;
              if (options.json) {
                options.stderr(`${JSON.stringify({ warning: msg }, null, 2)}\n`);
              } else {
                options.stderr(`Warning: ${msg}\n`);
              }
            }
          }
          if (!options.detached) {
            try {
              await execFileAsync('git', ['branch', '-D', worktreeName], { cwd: repository.repoRoot });
            } catch {
              // Branch may not exist; proceed anyway.
            }
          }
        }
      } else if (options.json || isHeadless()) {
        const message = `target worktree path already exists: ${worktreePath}`;
        if (options.json) {
          options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
        } else {
          options.stderr(`gji new: ${message} in non-interactive mode (GJI_NO_TUI=1)\n`);
          options.stderr(`Hint: Use 'gji remove ${worktreeName}' or 'gji clean' to remove the existing worktree\n`);
          options.stderr(`Hint: Use 'gji trigger-hook afterCreate' inside the worktree to re-run setup hooks\n`);
        }
        return 1;
      } else {
        const choice = await prompt(worktreePath);

        if (choice === 'reuse') {
          appendHistory(worktreePath, worktreeName).catch(() => undefined);
          await writeOutput(worktreePath, options.stdout);
          return 0;
        }

        options.stderr(`Aborted because target worktree path already exists: ${worktreePath}\n`);
        return 1;
      }
    }

    if (options.dryRun) {
      if (options.json) {
        options.stdout(`${JSON.stringify({ branch: worktreeName, path: worktreePath, dryRun: true }, null, 2)}\n`);
      } else {
        options.stdout(`Would create worktree at ${worktreePath} (branch: ${worktreeName})\n`);
      }
      return 0;
    }

    await mkdir(dirname(worktreePath), { recursive: true });
    const gitArgs = options.detached
      ? ['worktree', 'add', '--detach', worktreePath]
      : await localBranchExists(repository.repoRoot, worktreeName)
        ? ['worktree', 'add', worktreePath, worktreeName]
        : ['worktree', 'add', '-b', worktreeName, worktreePath];

    await execFileAsync('git', gitArgs, { cwd: repository.repoRoot });

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
      { branch: worktreeName, path: worktreePath, repo: basename(repository.repoRoot) },
      options.stderr,
    );

    if (options.json) {
      options.stdout(`${JSON.stringify({ branch: worktreeName, path: worktreePath }, null, 2)}\n`);
    } else {
      await appendHistory(worktreePath, worktreeName);
      await writeOutput(worktreePath, options.stdout);
    }

    return 0;
  };
}

export const runNewCommand = createNewCommand();

export function generateBranchPlaceholder(random: () => number = Math.random): string {
  const roots = [
    'socrates',
    'prometheus',
    'beethoven',
    'ada',
    'turing',
    'hypatia',
    'tesla',
    'curie',
    'diogenes',
    'plato',
    'hephaestus',
    'athena',
    'archimedes',
    'euclid',
    'heraclitus',
    'galileo',
    'newton',
    'lovelace',
    'nietzsche',
    'kafka',
  ];
  const antics = [
    'borrowed-a-bike',
    'brought-snacks',
    'missed-the-bus',
    'lost-the-keys',
    'spilled-the-coffee',
    'forgot-the-umbrella',
    'walked-the-dog',
    'missed-the-train',
    'wrote-a-poem',
    'burned-the-toast',
    'fed-the-pigeons',
    'watered-the-plants',
    'washed-the-dishes',
    'folded-the-laundry',
    'took-a-nap',
  ];

  return `${pickRandom(roots, random)}-${pickRandom(antics, random)}`;
}

function applyConfiguredBranchPrefix(branch: string, branchPrefix: unknown): string {
  if (typeof branchPrefix !== 'string' || branchPrefix.length === 0) {
    return branch;
  }

  if (branch.startsWith(branchPrefix)) {
    return branch;
  }

  return `${branchPrefix}${branch}`;
}

async function resolveUniqueDetachedWorktreePath(
  repoRoot: string,
  baseName: string,
  basePath?: string,
): Promise<string> {
  let attempt = 1;

  while (true) {
    const candidateName = attempt === 1 ? baseName : `${baseName}-${attempt}`;
    const candidatePath = resolveWorktreePath(repoRoot, candidateName, basePath);

    if (!await pathExists(candidatePath)) {
      return candidatePath;
    }

    attempt += 1;
  }
}

async function defaultPromptForBranch(placeholder: string): Promise<string | null> {
  const choice = await text({
    defaultValue: placeholder,
    message: 'Name the new branch',
    placeholder,
    validate: (value) => {
      const trimmed = value.trim();
      return validateBranchName(trimmed) ?? undefined;
    },
  });

  if (isCancel(choice)) {
    return null;
  }

  return choice.trim();
}

function pickRandom(values: string[], random: () => number): string {
  const index = Math.floor(random() * values.length);

  return values[Math.min(index, values.length - 1)];
}

async function localBranchExists(repoRoot: string, branchName: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

async function writeOutput(
  worktreePath: string,
  stdout: (chunk: string) => void,
): Promise<void> {
  await writeShellOutput(NEW_OUTPUT_FILE_ENV, worktreePath, stdout);
}

function isNotRegisteredWorktreeError(error: unknown): boolean {
  const stderr = hasExecStderr(error) ? error.stderr : String(error);
  return stderr.includes('is not a working tree') || stderr.includes('not a linked working tree');
}

function hasExecStderr(error: unknown): error is { stderr: string } {
  return error instanceof Error && 'stderr' in error && typeof (error as { stderr: unknown }).stderr === 'string';
}

function toExecMessage(error: unknown): string {
  return hasExecStderr(error) ? error.stderr.trim() : String(error);
}
