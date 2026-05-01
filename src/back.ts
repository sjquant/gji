import { access } from 'node:fs/promises';
import { basename } from 'node:path';

import { loadEffectiveConfig } from './config.js';
import { extractHooks, runHook } from './hooks.js';
import { appendHistory, loadHistory, type HistoryEntry } from './history.js';
import { detectRepository } from './repo.js';
import { writeShellOutput } from './shell-handoff.js';

export const BACK_OUTPUT_FILE_ENV = 'GJI_BACK_OUTPUT_FILE';

export interface BackCommandOptions {
  cwd: string;
  home?: string;
  list?: boolean;
  print?: boolean;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export async function runBackCommand(options: BackCommandOptions): Promise<number> {
  const history = await loadHistory(options.home);

  if (options.list) {
    if (history.length === 0) {
      options.stdout('No navigation history.\n');
      return 0;
    }
    options.stdout(formatHistoryList(history, options.cwd));
    return 0;
  }

  const target = history.find((entry) => entry.path !== options.cwd);

  if (!target) {
    options.stderr('gji back: no previous worktree in history\n');
    options.stderr("Hint: Use 'gji go', 'gji new', or 'gji pr' to navigate between worktrees\n");
    return 1;
  }

  try {
    await access(target.path);
  } catch {
    options.stderr(`gji back: previous worktree no longer exists: ${target.path}\n`);
    options.stderr("Hint: Use 'gji ls' to see available worktrees\n");
    return 1;
  }

  try {
    const repository = await detectRepository(target.path);
    const config = await loadEffectiveConfig(repository.repoRoot, options.home, options.stderr);
    const hooks = extractHooks(config);
    await runHook(
      hooks.afterEnter,
      target.path,
      { branch: target.branch ?? undefined, path: target.path, repo: basename(repository.repoRoot) },
      options.stderr,
    );
  } catch {
    // Not in a git repo or hooks unavailable — proceed without hook
  }

  await appendHistory(target.path, target.branch, options.home);
  await writeShellOutput(BACK_OUTPUT_FILE_ENV, target.path, options.stdout);
  return 0;
}

export function formatHistoryList(history: HistoryEntry[], cwd: string): string {
  const branchWidth = Math.max(
    'BRANCH'.length,
    ...history.map((e) => (e.branch ?? '(detached)').length),
  );

  const lines: string[] = ['  ' + 'BRANCH'.padEnd(branchWidth) + ' WHEN       PATH'];

  for (const entry of history) {
    const isCurrent = entry.path === cwd;
    const branch = (entry.branch ?? '(detached)').padEnd(branchWidth);
    const when = formatAge(entry.timestamp).padEnd(10);
    lines.push(`${isCurrent ? '*' : ' '} ${branch} ${when} ${entry.path}`);
  }

  return lines.join('\n') + '\n';
}

export function formatAge(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
