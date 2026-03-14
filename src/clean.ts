import { confirm, isCancel, multiselect } from '@clack/prompts';

import type { WorktreeEntry } from './repo.js';
import { loadLinkedWorktrees, removeWorktree } from './worktree-management.js';

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

    if (linkedWorktrees.length === 0) {
      options.stderr('No linked worktrees to clean\n');
      return 1;
    }

    const selectedPaths = await promptForWorktrees(linkedWorktrees);
    const selected = linkedWorktrees.filter((worktree) => selectedPaths?.includes(worktree.path));

    if (selected.length === 0 || !(await confirmRemoval(selected))) {
      options.stderr('Aborted\n');
      return 1;
    }

    for (const worktree of selected) {
      await removeWorktree(repository.repoRoot, worktree.path);
      options.stdout(`${worktree.path}\n`);
    }

    return 0;
  };
}

export const runCleanCommand = createCleanCommand();

async function defaultPromptForWorktrees(worktrees: WorktreeEntry[]): Promise<string[] | null> {
  const choice = await multiselect<string>({
    message: 'Choose worktrees to remove',
    options: worktrees.map((worktree) => ({
      hint: worktree.path,
      label: worktree.branch ?? '(detached)',
      value: worktree.path,
    })),
    required: false,
  });

  return isCancel(choice) ? null : choice;
}

async function defaultConfirmRemoval(worktrees: WorktreeEntry[]): Promise<boolean> {
  const choice = await confirm({
    message: `Remove ${worktrees.length} worktree${worktrees.length === 1 ? '' : 's'}?`,
    active: 'Yes',
    inactive: 'No',
    initialValue: false,
  });

  return !isCancel(choice) && choice;
}
