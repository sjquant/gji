import { basename } from 'node:path';

import { isCancel, select } from '@clack/prompts';
import { loadEffectiveConfig } from './config.js';
import { extractHooks, runHook } from './hooks.js';
import { detectRepository, listWorktrees, type WorktreeEntry } from './repo.js';
import { writeShellOutput } from './shell-handoff.js';

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

const GO_OUTPUT_FILE_ENV = 'GJI_GO_OUTPUT_FILE';

export function createGoCommand(
  dependencies: Partial<GoCommandDependencies> = {},
): (options: GoCommandOptions) => Promise<number> {
  const prompt = dependencies.promptForWorktree ?? promptForWorktree;

  return async function runGoCommand(options: GoCommandOptions): Promise<number> {
    const [worktrees, repository] = await Promise.all([
      listWorktrees(options.cwd),
      detectRepository(options.cwd),
    ]);

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

    const config = await loadEffectiveConfig(repository.repoRoot);
    const hooks = extractHooks(config);
    const chosenWorktree = worktrees.find((w) => w.path === chosenPath);
    await runHook(
      hooks.afterGo,
      chosenPath,
      { branch: chosenWorktree?.branch, path: chosenPath, repo: basename(repository.repoRoot) },
      options.stderr,
    );

    await writeShellOutput(GO_OUTPUT_FILE_ENV, chosenPath, options.stdout);
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
