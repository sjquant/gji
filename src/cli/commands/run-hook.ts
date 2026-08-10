import type { GjiHooks } from "../../ports/hooks.js";
import { type CliRuntime, defaultCliDependencies } from "../dependencies.js";

const VALID_HOOKS: Array<keyof GjiHooks> = [
	"after-create",
	"after-enter",
	"before-remove",
];

const CAMEL_ALIASES: Partial<Record<string, keyof GjiHooks>> = {
	afterCreate: "after-create",
	afterEnter: "after-enter",
	beforeRemove: "before-remove",
};

function isValidHook(hook: string): hook is keyof GjiHooks {
	return (VALID_HOOKS as string[]).includes(hook);
}

export interface RunHookCommandOptions {
	cwd: string;
	hook: string;
	runtime?: CliRuntime<
		"config" | "slots" | "hooks" | "repositoryContext" | "worktrees"
	>;
	stderr: (chunk: string) => void;
}

export async function runHookCommand(
	options: RunHookCommandOptions,
): Promise<number> {
	const runtime = options.runtime ?? defaultCliDependencies;
	const { loadEffectiveConfig } = runtime.config;
	const { getWorktreeSlot } = runtime.slots;
	const { extractHooks, runHook } = runtime.hooks;
	const { detectRepository } = runtime.repositoryContext;
	const { listWorktrees } = runtime.worktrees;
	const normalized = CAMEL_ALIASES[options.hook] ?? options.hook;
	if (!isValidHook(normalized)) {
		options.stderr(
			`gji run-hook: unknown hook '${options.hook}'. Valid hooks: ${VALID_HOOKS.join(", ")}\n`,
		);
		return 1;
	}

	const hookName = normalized;
	const repository = await detectRepository(options.cwd);
	const config = await loadEffectiveConfig(
		repository.repoRoot,
		undefined,
		options.stderr,
	);
	const hooks = extractHooks(config);

	// Find the branch for the current worktree (undefined for detached HEAD).
	const worktrees = await listWorktrees(options.cwd);
	const currentWorktree = worktrees.find(
		(w) => w.path === repository.currentRoot,
	);

	await runHook(
		hooks[hookName],
		repository.currentRoot,
		{
			branch: currentWorktree?.branch ?? undefined,
			path: repository.currentRoot,
			repo: repository.repoName,
			slot: await getWorktreeSlot(repository.currentRoot),
		},
		options.stderr,
	);

	return 0;
}
