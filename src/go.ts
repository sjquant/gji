import { isCancel, select } from '@clack/prompts';
import { listWorktrees, type WorktreeEntry } from './repo.js';

export interface GoCommandOptions {
  branch?: string;
  cwd: string;
  print?: boolean;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export interface GoCommandDependencies {
  promptForWorktree: (worktrees: WorktreeEntry[]) => Promise<string | null>;
}

export function createGoCommand(
  dependencies: Partial<GoCommandDependencies> = {},
): (options: GoCommandOptions) => Promise<number> {
  const prompt = dependencies.promptForWorktree ?? promptForWorktree;

  return async function runGoCommand(options: GoCommandOptions): Promise<number> {
    const worktrees = await listWorktrees(options.cwd);

    if (options.branch) {
      const worktree = worktrees.find((entry) => entry.branch === options.branch);

      if (!worktree) {
        options.stderr(`No worktree found for branch: ${options.branch}\n`);
        return 1;
      }

      options.stdout(`${worktree.path}\n`);
      return 0;
    }

    const chosenPath = await prompt(worktrees);

    if (!chosenPath) {
      options.stderr('Aborted\n');
      return 1;
    }

    options.stdout(`${chosenPath}\n`);
    return 0;
  };
}

export const runGoCommand = createGoCommand();

async function promptForWorktree(
  worktrees: WorktreeEntry[],
): Promise<string | null> {
  const choice = await select<string>({
    message: 'Choose a worktree',
    options: worktrees.map((worktree) => ({
      value: worktree.path,
      label: worktree.branch ?? '(detached)',
      hint: worktree.path,
    })),
  });

  if (isCancel(choice)) {
    return null;
  }

  return choice;
}
