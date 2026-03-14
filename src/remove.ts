import { confirm, isCancel, select } from '@clack/prompts';

import type { WorktreeEntry } from './repo.js';
import {
  deleteBranch,
  loadLinkedWorktrees,
  removeWorktree,
} from './worktree-management.js';

export interface RemoveCommandOptions {
  branch?: string;
  cwd: string;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export interface RemoveCommandDependencies {
  confirmRemoval: (worktree: WorktreeEntry) => Promise<boolean>;
  promptForWorktree: (worktrees: WorktreeEntry[]) => Promise<string | null>;
}

export function createRemoveCommand(
  dependencies: Partial<RemoveCommandDependencies> = {},
): (options: RemoveCommandOptions) => Promise<number> {
  const promptForWorktree = dependencies.promptForWorktree ?? defaultPromptForWorktree;
  const confirmRemoval = dependencies.confirmRemoval ?? defaultConfirmRemoval;

  return async function runRemoveCommand(options: RemoveCommandOptions): Promise<number> {
    const { linkedWorktrees, repository } = await loadLinkedWorktrees(options.cwd);

    if (linkedWorktrees.length === 0) {
      options.stderr('No linked worktrees to finish\n');
      return 1;
    }

    const selection = options.branch ?? (await promptForWorktree(linkedWorktrees));

    if (!selection) {
      options.stderr('Aborted\n');
      return 1;
    }

    const worktree = linkedWorktrees.find(
      (entry) => entry.branch === selection || entry.path === selection,
    );

    if (!worktree) {
      options.stderr(`No linked worktree found for branch: ${selection}\n`);
      return 1;
    }

    if (!(await confirmRemoval(worktree))) {
      options.stderr('Aborted\n');
      return 1;
    }

    await removeWorktree(repository.repoRoot, worktree.path);

    if (worktree.branch) {
      await deleteBranch(repository.repoRoot, worktree.branch);
    }

    options.stdout(`${repository.repoRoot}\n`);

    return 0;
  };
}

export const runRemoveCommand = createRemoveCommand();

async function defaultPromptForWorktree(worktrees: WorktreeEntry[]): Promise<string | null> {
  const choice = await select<string>({
    message: 'Choose a worktree to finish',
    options: worktrees.map((worktree) => ({
      hint: worktree.path,
      label: worktree.branch ?? '(detached)',
      value: worktree.path,
    })),
  });

  return isCancel(choice) ? null : choice;
}

async function defaultConfirmRemoval(worktree: WorktreeEntry): Promise<boolean> {
  const choice = await confirm({
    message: worktree.branch
      ? `Remove worktree and delete branch ${worktree.branch}?`
      : `Remove detached worktree ${worktree.path}?`,
    active: 'Yes',
    inactive: 'No',
    initialValue: true,
  });

  return !isCancel(choice) && choice;
}
