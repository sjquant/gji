import { confirm, isCancel, select } from '@clack/prompts';

import type { WorktreeEntry } from './repo.js';
import {
  deleteBranch,
  loadLinkedWorktrees,
  removeWorktree,
} from './worktree-management.js';

export interface DoneCommandOptions {
  branch?: string;
  cwd: string;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export interface DoneCommandDependencies {
  confirmRemoval: (worktree: WorktreeEntry) => Promise<boolean>;
  promptForBranch: (worktrees: WorktreeEntry[]) => Promise<string | null>;
}

export function createDoneCommand(
  dependencies: Partial<DoneCommandDependencies> = {},
): (options: DoneCommandOptions) => Promise<number> {
  const promptForBranch = dependencies.promptForBranch ?? defaultPromptForBranch;
  const confirmRemoval = dependencies.confirmRemoval ?? defaultConfirmRemoval;

  return async function runDoneCommand(options: DoneCommandOptions): Promise<number> {
    const { linkedWorktrees, repository } = await loadLinkedWorktrees(options.cwd);
    const linkedBranchWorktrees = linkedWorktrees.filter(
      (worktree): worktree is WorktreeEntry & { branch: string } => worktree.branch !== null,
    );

    if (linkedBranchWorktrees.length === 0) {
      options.stderr('No linked branch worktrees to finish\n');
      return 1;
    }

    const branch = options.branch ?? (await promptForBranch(linkedBranchWorktrees));

    if (!branch) {
      options.stderr('Aborted\n');
      return 1;
    }

    const worktree = linkedBranchWorktrees.find((entry) => entry.branch === branch);

    if (!worktree) {
      options.stderr(`No linked worktree found for branch: ${branch}\n`);
      return 1;
    }

    if (!(await confirmRemoval(worktree))) {
      options.stderr('Aborted\n');
      return 1;
    }

    await removeWorktree(repository.repoRoot, worktree.path);
    await deleteBranch(repository.repoRoot, branch);
    options.stdout(`${repository.repoRoot}\n`);

    return 0;
  };
}

export const runDoneCommand = createDoneCommand();

async function defaultPromptForBranch(worktrees: WorktreeEntry[]): Promise<string | null> {
  const choice = await select<string>({
    message: 'Choose a worktree to finish',
    options: worktrees.map((worktree) => ({
      hint: worktree.path,
      label: worktree.branch ?? '(detached)',
      value: worktree.branch ?? worktree.path,
    })),
  });

  return isCancel(choice) ? null : choice;
}

async function defaultConfirmRemoval(worktree: WorktreeEntry): Promise<boolean> {
  const choice = await confirm({
    message: `Remove worktree and delete branch ${worktree.branch}?`,
    active: 'Yes',
    inactive: 'No',
    initialValue: false,
  });

  return !isCancel(choice) && choice;
}
