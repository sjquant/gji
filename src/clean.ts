import { confirm, isCancel, multiselect } from '@clack/prompts';

import type { WorktreeEntry } from './repo.js';
import {
  deleteBranch,
  loadLinkedWorktrees,
  removeWorktree,
} from './worktree-management.js';

export interface CleanCommandOptions {
  cwd: string;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export interface CleanCommandDependencies {
  confirmRemoval: (worktrees: WorktreeEntry[]) => Promise<boolean>;
  promptForWorktrees: (worktrees: WorktreeEntry[]) => Promise<string[] | null>;
}

export function createCleanCommand(
  dependencies: Partial<CleanCommandDependencies> = {},
): (options: CleanCommandOptions) => Promise<number> {
  const promptForWorktrees = dependencies.promptForWorktrees ?? defaultPromptForWorktrees;
  const confirmRemoval = dependencies.confirmRemoval ?? defaultConfirmRemoval;

  return async function runCleanCommand(options: CleanCommandOptions): Promise<number> {
    const { linkedWorktrees, repository } = await loadLinkedWorktrees(options.cwd);
    const cleanupCandidates = linkedWorktrees.filter(
      (worktree) => worktree.path !== repository.currentRoot,
    );

    if (cleanupCandidates.length === 0) {
      options.stderr('No linked worktrees to clean\n');
      return 1;
    }

    const selections = await promptForWorktrees(cleanupCandidates);

    if (!selections || selections.length === 0) {
      options.stderr('Aborted\n');
      return 1;
    }

    const selectedWorktrees = resolveSelectedWorktrees(cleanupCandidates, selections);

    if (selectedWorktrees.length !== selections.length) {
      options.stderr('Selected worktree no longer exists\n');
      return 1;
    }

    if (!(await confirmRemoval(selectedWorktrees))) {
      options.stderr('Aborted\n');
      return 1;
    }

    for (const worktree of selectedWorktrees) {
      await removeWorktree(repository.repoRoot, worktree.path);

      if (worktree.branch) {
        await deleteBranch(repository.repoRoot, worktree.branch);
      }
    }

    options.stdout(`${repository.repoRoot}\n`);

    return 0;
  };
}

export const runCleanCommand = createCleanCommand();

function resolveSelectedWorktrees(
  worktrees: WorktreeEntry[],
  selections: string[],
): WorktreeEntry[] {
  const selectedWorktrees: WorktreeEntry[] = [];
  const seenPaths = new Set<string>();

  for (const selection of selections) {
    const worktree = worktrees.find(
      (entry) => entry.path === selection || entry.branch === selection,
    );

    if (!worktree || seenPaths.has(worktree.path)) {
      continue;
    }

    selectedWorktrees.push(worktree);
    seenPaths.add(worktree.path);
  }

  return selectedWorktrees;
}

async function defaultPromptForWorktrees(
  worktrees: WorktreeEntry[],
): Promise<string[] | null> {
  const choice = await multiselect<string>({
    message: 'Choose worktrees to clean',
    options: worktrees.map((worktree) => ({
      hint: worktree.path,
      label: worktree.branch ?? '(detached)',
      value: worktree.path,
    })),
    required: true,
  });

  return isCancel(choice) ? null : choice;
}

async function defaultConfirmRemoval(worktrees: WorktreeEntry[]): Promise<boolean> {
  const branchCount = worktrees.filter((worktree) => worktree.branch !== null).length;
  const detachedCount = worktrees.length - branchCount;
  const messageParts = [`Remove ${worktrees.length} linked worktree${worktrees.length === 1 ? '' : 's'}`];

  if (branchCount > 0) {
    messageParts.push(`delete ${branchCount} branch${branchCount === 1 ? '' : 'es'}`);
  }

  if (detachedCount > 0) {
    messageParts.push(`remove ${detachedCount} detached worktree${detachedCount === 1 ? '' : 's'}`);
  }

  const choice = await confirm({
    active: 'Yes',
    inactive: 'No',
    initialValue: true,
    message: `${messageParts.join(', ')}?`,
  });

  return !isCancel(choice) && choice;
}
