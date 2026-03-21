import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isCancel, select, text } from '@clack/prompts';

import { loadEffectiveConfig } from './config.js';
import { detectRepository, resolveWorktreePath } from './repo.js';

const execFileAsync = promisify(execFile);
export type PathConflictChoice = 'abort' | 'reuse';

export interface NewCommandOptions {
  branch?: string;
  cwd: string;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export interface NewCommandDependencies {
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
    const config = await loadEffectiveConfig(repository.repoRoot);
    const rawBranch = options.branch ?? await promptForBranch(createBranchPlaceholder());

    if (!rawBranch) {
      options.stderr('Aborted\n');
      return 1;
    }

    const branch = applyConfiguredBranchPrefix(rawBranch, config.branchPrefix);
    const worktreePath = resolveWorktreePath(repository.repoRoot, branch);

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
      ['worktree', 'add', '-b', branch, worktreePath],
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
