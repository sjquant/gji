import { confirm, isCancel, select } from '@clack/prompts';

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
import { writeShellOutput } from './shell-handoff.js';

export interface RemoveCommandOptions {
  branch?: string;
  cwd: string;
  force?: boolean;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export interface RemoveCommandDependencies {
  confirmForceDeleteBranch: (branch: string) => Promise<boolean>;
  confirmForceRemoveWorktree: (worktreePath: string) => Promise<boolean>;
  confirmRemoval: (worktree: WorktreeEntry) => Promise<boolean>;
  promptForWorktree: (worktrees: WorktreeEntry[]) => Promise<string | null>;
}

const REMOVE_OUTPUT_FILE_ENV = 'GJI_REMOVE_OUTPUT_FILE';

export function createRemoveCommand(
  dependencies: Partial<RemoveCommandDependencies> = {},
): (options: RemoveCommandOptions) => Promise<number> {
  const promptForWorktree = dependencies.promptForWorktree ?? defaultPromptForWorktree;
  const confirmRemoval = dependencies.confirmRemoval ?? defaultConfirmRemoval;
  const confirmForceRemoveWorktree = dependencies.confirmForceRemoveWorktree ?? defaultConfirmForceRemoveWorktree;
  const confirmForceDeleteBranch = dependencies.confirmForceDeleteBranch ?? defaultConfirmForceDeleteBranch;

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

    try {
      await removeWorktree(repository.repoRoot, worktree.path);
    } catch (error) {
      if (!isWorktreeDirtyError(error)) {
        throw error;
      }

      if (!options.force && !(await confirmForceRemoveWorktree(worktree.path))) {
        options.stderr('Aborted\n');
        return 1;
      }

      await forceRemoveWorktree(repository.repoRoot, worktree.path);
    }

    if (worktree.branch) {
      try {
        await deleteBranch(repository.repoRoot, worktree.branch);
      } catch (error) {
        if (!isBranchUnmergedError(error)) {
          throw error;
        }

        if (options.force || (await confirmForceDeleteBranch(worktree.branch))) {
          await forceDeleteBranch(repository.repoRoot, worktree.branch);
        }
      }
    }

    await writeOutput(repository.repoRoot, options.stdout);

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

async function defaultConfirmForceRemoveWorktree(worktreePath: string): Promise<boolean> {
  const choice = await confirm({
    active: 'Yes',
    inactive: 'No',
    initialValue: false,
    message: `Worktree at ${worktreePath} has untracked or modified files. Force remove?`,
  });

  return !isCancel(choice) && choice;
}

async function defaultConfirmForceDeleteBranch(branch: string): Promise<boolean> {
  const choice = await confirm({
    active: 'Yes',
    inactive: 'No',
    initialValue: false,
    message: `Branch ${branch} has unmerged commits. Force delete?`,
  });

  return !isCancel(choice) && choice;
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

async function writeOutput(
  repoRoot: string,
  stdout: (chunk: string) => void,
): Promise<void> {
  await writeShellOutput(REMOVE_OUTPUT_FILE_ENV, repoRoot, stdout);
}
