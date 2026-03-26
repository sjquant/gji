import { confirm, isCancel, multiselect } from '@clack/prompts';

import type { WorktreeEntry } from './repo.js';
import {
  deleteBranch,
  forceDeleteBranch,
  forceRemoveWorktree,
  isBranchUnmergedError,
  isWorktreeDirtyError,
  loadLinkedWorktrees,
  removeWorktree,
} from './worktree-management.js';
import { defaultConfirmForceDeleteBranch, defaultConfirmForceRemoveWorktree } from './worktree-prompts.js';

export interface CleanCommandOptions {
  cwd: string;
  force?: boolean;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export interface CleanCommandDependencies {
  confirmForceDeleteBranch: (branch: string) => Promise<boolean>;
  confirmForceRemoveWorktree: (worktreePath: string) => Promise<boolean>;
  confirmRemoval: (worktrees: WorktreeEntry[]) => Promise<boolean>;
  promptForWorktrees: (worktrees: WorktreeEntry[]) => Promise<string[] | null>;
}

export function createCleanCommand(
  dependencies: Partial<CleanCommandDependencies> = {},
): (options: CleanCommandOptions) => Promise<number> {
  const promptForWorktrees = dependencies.promptForWorktrees ?? defaultPromptForWorktrees;
  const confirmRemoval = dependencies.confirmRemoval ?? defaultConfirmRemoval;
  const confirmForceRemoveWorktree = dependencies.confirmForceRemoveWorktree ?? defaultConfirmForceRemoveWorktree;
  const confirmForceDeleteBranch = dependencies.confirmForceDeleteBranch ?? defaultConfirmForceDeleteBranch;

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

    if (!options.force && !(await confirmRemoval(selectedWorktrees))) {
      options.stderr('Aborted\n');
      return 1;
    }

    const removedPaths: string[] = [];

    for (const worktree of selectedWorktrees) {
      try {
        await removeWorktree(repository.repoRoot, worktree.path);
      } catch (error) {
        if (!isWorktreeDirtyError(error)) {
          throw error;
        }

        if (!options.force && !(await confirmForceRemoveWorktree(worktree.path))) {
          reportRemovedPaths(removedPaths, options.stderr);
          options.stderr('Aborted\n');
          return 1;
        }

        try {
          await forceRemoveWorktree(repository.repoRoot, worktree.path);
        } catch (forceError) {
          reportRemovedPaths(removedPaths, options.stderr);
          options.stderr(`Failed to remove worktree at ${worktree.path}: ${toMessage(forceError)}\n`);
          return 1;
        }
      }

      removedPaths.push(worktree.path);

      if (worktree.branch) {
        try {
          await deleteBranch(repository.repoRoot, worktree.branch);
        } catch (error) {
          if (!isBranchUnmergedError(error)) {
            throw error;
          }

          if (options.force || (await confirmForceDeleteBranch(worktree.branch))) {
            try {
              await forceDeleteBranch(repository.repoRoot, worktree.branch);
            } catch (forceError) {
              options.stderr(`Failed to delete branch ${worktree.branch}: ${toMessage(forceError)}\n`);
            }
          } else {
            options.stderr(`Branch ${worktree.branch} was not deleted (has unmerged commits)\n`);
          }
        }
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

function reportRemovedPaths(paths: string[], stderr: (chunk: string) => void): void {
  if (paths.length > 0) {
    stderr(`Already removed: ${paths.join(', ')}\n`);
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
