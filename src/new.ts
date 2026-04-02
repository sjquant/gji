import { mkdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isCancel, text } from '@clack/prompts';

import { loadEffectiveConfig } from './config.js';
import { syncFiles } from './file-sync.js';
import { extractHooks, runHook } from './hooks.js';
import { type InstallPromptDependencies, maybeRunInstallPrompt } from './install-prompt.js';
import { type PathConflictChoice, pathExists, promptForPathConflict } from './conflict.js';
import { detectRepository, resolveWorktreePath } from './repo.js';
import { writeShellOutput } from './shell-handoff.js';

const execFileAsync = promisify(execFile);
export type { PathConflictChoice };
const NEW_OUTPUT_FILE_ENV = 'GJI_NEW_OUTPUT_FILE';

export interface NewCommandOptions {
  branch?: string;
  cwd: string;
  detached?: boolean;
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
  const installDeps: InstallPromptDependencies = {
    detectInstallPackageManager: dependencies.detectInstallPackageManager,
    promptForInstallChoice: dependencies.promptForInstallChoice,
    runInstallCommand: dependencies.runInstallCommand,
    writeConfigKey: dependencies.writeConfigKey,
  };

  return async function runNewCommand(options: NewCommandOptions): Promise<number> {
    const repository = await detectRepository(options.cwd);
    const config = await loadEffectiveConfig(repository.repoRoot);
    const usesGeneratedDetachedName = options.detached && options.branch === undefined;
    const rawBranch = options.detached
      ? options.branch ?? createBranchPlaceholder()
      : options.branch ?? await promptForBranch(createBranchPlaceholder());

    if (!rawBranch) {
      options.stderr('Aborted\n');
      return 1;
    }

    const worktreeName = options.detached
      ? rawBranch
      : applyConfiguredBranchPrefix(rawBranch, config.branchPrefix);
    const worktreePath = usesGeneratedDetachedName
      ? await resolveUniqueDetachedWorktreePath(repository.repoRoot, worktreeName)
      : resolveWorktreePath(repository.repoRoot, worktreeName);

    if (!usesGeneratedDetachedName && await pathExists(worktreePath)) {
      const choice = await prompt(worktreePath);

      if (choice === 'reuse') {
        await writeOutput(worktreePath, options.stdout);
        return 0;
      }

      options.stderr(`Aborted because target worktree path already exists: ${worktreePath}\n`);
      return 1;
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

    await maybeRunInstallPrompt(worktreePath, repository.repoRoot, config, options.stderr, installDeps);

    const hooks = extractHooks(config);
    await runHook(
      hooks.afterCreate,
      worktreePath,
      { branch: worktreeName, path: worktreePath, repo: basename(repository.repoRoot) },
      options.stderr,
    );

    await writeOutput(worktreePath, options.stdout);

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
): Promise<string> {
  let attempt = 1;

  while (true) {
    const candidateName = attempt === 1 ? baseName : `${baseName}-${attempt}`;
    const candidatePath = resolveWorktreePath(repoRoot, candidateName);

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
    validate: (value) => value.trim().length === 0 ? 'Branch name must not be empty.' : undefined,
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
