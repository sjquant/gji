import { basename } from 'node:path';

import { isCancel, select } from '@clack/prompts';
import { loadEffectiveConfig } from './config.js';
import { readWorktreeHealth, type WorktreeHealth } from './git.js';
import { isHeadless } from './headless.js';
import { extractHooks, runHook } from './hooks.js';
import { appendHistory } from './history.js';
import { detectRepository, listWorktrees, sortByCurrentFirst, type WorktreeEntry } from './repo.js';
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

    if (!options.branch && isHeadless()) {
      options.stderr('gji go: branch argument is required in non-interactive mode (GJI_NO_TUI=1)\n');
      return 1;
    }

    const prompted = options.branch ? null : await prompt(sortByCurrentFirst(worktrees));
    const resolvedPath = options.branch
      ? worktrees.find((entry) => entry.branch === options.branch)?.path
      : prompted ?? undefined;

    if (!resolvedPath) {
      if (options.branch) {
        options.stderr(`No worktree found for branch: ${options.branch}\n`);
        options.stderr(`Hint: Use 'gji ls' to see available worktrees\n`);
      } else {
        options.stderr('Aborted\n');
      }
      return 1;
    }

    const chosenWorktree = worktrees.find((w) => w.path === resolvedPath);

    const config = await loadEffectiveConfig(repository.repoRoot, undefined, options.stderr);
    const hooks = extractHooks(config);
    await runHook(
      hooks.afterEnter,
      resolvedPath,
      { branch: chosenWorktree?.branch ?? undefined, path: resolvedPath, repo: basename(repository.repoRoot) },
      options.stderr,
    );

    await appendHistory(resolvedPath, chosenWorktree?.branch ?? null);
    await writeShellOutput(GO_OUTPUT_FILE_ENV, resolvedPath, options.stdout);
    return 0;
  };
}

export const runGoCommand = createGoCommand();

async function promptForWorktree(
  worktrees: WorktreeEntry[],
): Promise<string | null> {
  const healthResults = await Promise.allSettled(
    worktrees.map((w) => readWorktreeHealth(w.path)),
  );

  const choice = await select<string>({
    message: 'Choose a worktree',
    options: worktrees.map((worktree, i) => {
      const health = healthResults[i].status === 'fulfilled' ? healthResults[i].value : null;
      const pathHint = worktree.isCurrent ? `${worktree.path} (current)` : worktree.path;
      const upstream = health ? formatUpstreamHint(worktree.branch, health) : null;
      return {
        value: worktree.path,
        label: worktree.branch ?? '(detached)',
        hint: upstream ? `${upstream} · ${pathHint}` : pathHint,
      };
    }),
  });

  if (isCancel(choice)) {
    return null;
  }

  return choice;
}

export function formatUpstreamHint(branch: string | null, health: WorktreeHealth): string | null {
  if (branch === null) return null;
  if (!health.hasUpstream) return 'no upstream';
  if (health.upstreamGone) return 'upstream gone';
  if (health.ahead === 0 && health.behind === 0) return 'up to date';
  if (health.ahead === 0) return `behind ${health.behind}`;
  if (health.behind === 0) return `ahead ${health.ahead}`;
  return `ahead ${health.ahead}, behind ${health.behind}`;
}

