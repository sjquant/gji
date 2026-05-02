import { isCancel, select } from '@clack/prompts';

import { readWorktreeHealth } from './git.js';
import { isHeadless } from './headless.js';
import { appendHistory } from './history.js';
import { formatUpstreamHint } from './go.js';
import { runNewCommand } from './new.js';
import { loadRegistry, type RepoRegistryEntry } from './repo-registry.js';
import { listWorktrees, type WorktreeEntry } from './repo.js';
import { writeShellOutput } from './shell-handoff.js';

const WARP_OUTPUT_FILE_ENV = 'GJI_WARP_OUTPUT_FILE';

export interface WarpCommandOptions {
  branch?: string;
  cwd: string;
  newWorktree?: boolean;
  print?: boolean;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

interface WarpItem {
  repoName: string;
  repoRoot: string;
  worktree: WorktreeEntry;
}

export async function runWarpCommand(options: WarpCommandOptions): Promise<number> {
  const registry = await loadRegistry();

  if (registry.length === 0) {
    options.stderr(
      'gji warp: no repos registered yet.\n' +
      'Use any gji command in a repository to register it automatically.\n',
    );
    return 1;
  }

  if (options.newWorktree) {
    return runWarpNew(options, registry);
  }

  return runWarpNavigate(options, registry);
}

async function runWarpNavigate(
  options: WarpCommandOptions,
  registry: RepoRegistryEntry[],
): Promise<number> {
  if (isHeadless() && !options.branch) {
    options.stderr(
      'gji warp: branch argument is required in non-interactive mode (GJI_NO_TUI=1)\n',
    );
    return 1;
  }

  const results = await Promise.allSettled(
    registry.map(async (entry) => {
      const worktrees = await listWorktrees(entry.path);
      return { repoName: entry.name, repoRoot: entry.path, worktrees };
    }),
  );

  const allItems: WarpItem[] = [];
  for (const result of results) {
    if (result.status === 'rejected') continue;
    const { repoName, repoRoot, worktrees } = result.value;
    for (const worktree of worktrees) {
      allItems.push({ repoName, repoRoot, worktree });
    }
  }

  if (allItems.length === 0) {
    options.stderr('gji warp: no accessible worktrees found in any registered repo.\n');
    return 1;
  }

  let resolvedPath: string | null = null;

  if (options.branch) {
    const match = findByQuery(allItems, options.branch);
    if (!match) {
      options.stderr(`gji warp: no worktree found matching: ${options.branch}\n`);
      return 1;
    }
    resolvedPath = match.worktree.path;
  } else {
    resolvedPath = await promptForWarpTarget(allItems);
  }

  if (!resolvedPath) {
    options.stderr('Aborted\n');
    return 1;
  }

  const chosen = allItems.find((item) => item.worktree.path === resolvedPath);
  appendHistory(resolvedPath, chosen?.worktree.branch ?? null).catch(() => undefined);

  await writeShellOutput(WARP_OUTPUT_FILE_ENV, resolvedPath, options.stdout);
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

async function promptForWarpTarget(items: WarpItem[]): Promise<string | null> {
  const healthResults = await Promise.allSettled(
    items.map((item) => readWorktreeHealth(item.worktree.path)),
  );

  const choice = await select<string>({
    message: 'Warp to a worktree',
    options: items.map((item, i) => {
      const health = healthResults[i].status === 'fulfilled' ? healthResults[i].value : null;
      const upstream = health ? formatUpstreamHint(item.worktree.branch, health) : null;
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
