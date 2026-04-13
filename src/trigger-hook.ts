import { loadEffectiveConfig } from './config.js';
import { type GjiHooks, extractHooks, runHook } from './hooks.js';
import { detectRepository, listWorktrees } from './repo.js';

const VALID_HOOKS: Array<keyof GjiHooks> = ['afterCreate', 'afterEnter', 'beforeRemove'];

export interface TriggerHookCommandOptions {
  cwd: string;
  hook: string;
  stderr: (chunk: string) => void;
}

export async function runTriggerHookCommand(options: TriggerHookCommandOptions): Promise<number> {
  if (!(VALID_HOOKS as string[]).includes(options.hook)) {
    options.stderr(
      `gji trigger-hook: unknown hook '${options.hook}'. Valid hooks: ${VALID_HOOKS.join(', ')}\n`,
    );
    return 1;
  }

  const hookName = options.hook as keyof GjiHooks;
  const repository = await detectRepository(options.cwd);
  const config = await loadEffectiveConfig(repository.repoRoot);
  const hooks = extractHooks(config);

  // Find the branch for the current worktree (null for detached HEAD).
  const worktrees = await listWorktrees(options.cwd);
  const currentWorktree = worktrees.find((w) => w.path === repository.currentRoot);

  await runHook(
    hooks[hookName],
    repository.currentRoot,
    {
      branch: currentWorktree?.branch ?? undefined,
      path: repository.currentRoot,
      repo: repository.repoName,
    },
    options.stderr,
  );

  return 0;
}
