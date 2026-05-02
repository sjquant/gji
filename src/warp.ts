import { isCancel, select } from '@clack/prompts';

import { readWorktreeHealth, type WorktreeHealth } from './git.js';
import { isHeadless } from './headless.js';
import { appendHistory } from './history.js';
import { runNewCommand } from './new.js';
import { loadRegistry, type RepoRegistryEntry } from './repo-registry.js';
import { listWorktrees, type WorktreeEntry } from './repo.js';
import { writeShellOutput } from './shell-handoff.js';

const WARP_OUTPUT_FILE_ENV = 'GJI_WARP_OUTPUT_FILE';

export interface WarpCommandOptions {
  branch?: string;
  cwd: string;
  newWorktree?: boolean;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

interface WarpItem {
  repoName: string;
  worktree: WorktreeEntry;
}

export async function runWarpCommand(options: WarpCommandOptions): Promise<number> {
  if (options.newWorktree) {
    const registry = await loadRegistry();
    if (registry.length === 0) {
      options.stderr(
        'gji warp: no repos registered yet.\n' +
        'Use any gji command in a repository to register it automatically.\n',
      );
      return 1;
    }
    return runWarpNew(options, registry);
  }

  return runWarpNavigate(options);
}

async function runWarpNavigate(
  options: WarpCommandOptions,
): Promise<number> {
  if (isHeadless() && !options.branch) {
    options.stderr(
      'gji warp: branch argument is required in non-interactive mode (GJI_NO_TUI=1)\n',
    );
    return 1;
  }

  const target = await resolveWarpTarget({ ...options, commandName: 'gji warp' });
  if (!target) return 1;

  appendHistory(target.path, target.branch).catch(() => undefined);
  await writeShellOutput(WARP_OUTPUT_FILE_ENV, target.path, options.stdout);
  return 0;
}

async function runWarpNew(
  options: WarpCommandOptions,
  registry: RepoRegistryEntry[],
): Promise<number> {
  let targetRepoRoot: string;

  if (registry.length === 1) {
    targetRepoRoot = registry[0].path;
  } else {
    if (isHeadless()) {
      options.stderr(
        'gji warp: repo argument is required in non-interactive mode (GJI_NO_TUI=1)\n',
      );
      return 1;
    }

    const choice = await select<string>({
      message: 'Create worktree in which repo?',
      options: registry.map((entry) => ({
        value: entry.path,
        label: entry.name,
        hint: entry.path,
      })),
    });

    if (isCancel(choice)) {
      options.stderr('Aborted\n');
      return 1;
    }

    targetRepoRoot = choice;
  }

  // runNewCommand writes the created path to options.stdout via writeShellOutput.
  // Since GJI_NEW_OUTPUT_FILE is not set in the warp shell context, it falls
  // through to our captured stdout, giving us the path to hand off.
  let capturedPath = '';
  const captureStdout = (chunk: string) => {
    capturedPath = chunk.trim();
  };

  const exitCode = await runNewCommand({
    branch: options.branch,
    cwd: targetRepoRoot,
    stderr: options.stderr,
    stdout: captureStdout,
  });

  if (exitCode !== 0) {
    return exitCode;
  }

  if (!capturedPath) {
    options.stderr('gji warp: could not determine new worktree path\n');
    return 1;
  }

  await writeShellOutput(WARP_OUTPUT_FILE_ENV, capturedPath, options.stdout);
  return 0;
}

function findByQuery(items: WarpItem[], query: string): WarpItem | null {
  const slashIdx = query.indexOf('/');
  if (slashIdx !== -1) {
    const repoQuery = query.slice(0, slashIdx);
    const branchQuery = query.slice(slashIdx + 1);
    const match = items.find(
      (item) => item.repoName === repoQuery && item.worktree.branch === branchQuery,
    );
    if (match) return match;
  }

  return items.find((item) => item.worktree.branch === query) ?? null;
}

export interface WarpTarget {
  branch: string | null;
  path: string;
}

export async function resolveWarpTarget(
  options: { branch?: string; commandName?: string; cwd: string; stderr: (chunk: string) => void },
): Promise<WarpTarget | null> {
  const cmd = options.commandName ?? 'gji';
  const registry = await loadRegistry();
  if (registry.length === 0) {
    options.stderr(
      `${cmd}: not in a git repository and no repos registered yet.\n` +
      'Use any gji command inside a repository to register it.\n',
    );
    return null;
  }

  const results = await Promise.allSettled(
    registry.map(async (entry) => {
      const worktrees = await listWorktrees(entry.path);
      return { repoName: entry.name, worktrees };
    }),
  );

  const allItems: WarpItem[] = [];
  for (const result of results) {
    if (result.status === 'rejected') continue;
    const { repoName, worktrees } = result.value;
    for (const worktree of worktrees) {
      allItems.push({ repoName, worktree });
    }
  }

  if (allItems.length === 0) {
    options.stderr(`${cmd}: no accessible worktrees found in any registered repo.\n`);
    return null;
  }

  if (options.branch) {
    const match = findByQuery(allItems, options.branch);
    if (!match) {
      options.stderr(`${cmd}: no worktree found matching: ${options.branch}\n`);
      return null;
    }
    return { branch: match.worktree.branch, path: match.worktree.path };
  }

  const path = await promptForWarpTarget(allItems);
  if (!path) {
    options.stderr('Aborted\n');
    return null;
  }
  const chosen = allItems.find((item) => item.worktree.path === path);
  return { branch: chosen?.worktree.branch ?? null, path };
}

async function promptForWarpTarget(items: WarpItem[]): Promise<string | null> {
  const healthResults = await Promise.allSettled(
    items.map((item) => readWorktreeHealth(item.worktree.path)),
  );

  const choice = await select<string>({
    message: 'Warp to a worktree',
    options: items.map((item, i) => {
      const health = healthResults[i].status === 'fulfilled' ? healthResults[i].value : null;
      const upstream = health ? formatHint(item.worktree.branch, health) : null;
      const label = `${item.repoName} › ${item.worktree.branch ?? '(detached)'}`;
      const pathHint = item.worktree.isCurrent
        ? `${item.worktree.path} (current)`
        : item.worktree.path;
      const hint = upstream ? `${upstream} · ${pathHint}` : pathHint;
      return { hint, label, value: item.worktree.path };
    }),
  });

  if (isCancel(choice)) {
    return null;
  }

  return choice;
}

function formatHint(branch: string | null, health: WorktreeHealth): string | null {
  if (branch === null) return null;
  if (!health.hasUpstream) return 'no upstream';
  if (health.upstreamGone) return 'upstream gone';
  if (health.ahead === 0 && health.behind === 0) return 'up to date';
  if (health.ahead === 0) return `behind ${health.behind}`;
  if (health.behind === 0) return `ahead ${health.ahead}`;
  return `ahead ${health.ahead}, behind ${health.behind}`;
}
