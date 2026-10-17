export type GjiHookCommand = string | string[];

export interface GjiHooks {
	/** A new branch was created by `gji new`, in a new worktree or in place. */
	"after-branch-create"?: GjiHookCommand;
	/** A linked worktree was created and bootstrapped. */
	"after-create"?: GjiHookCommand;
	/** An existing worktree was entered. */
	"after-enter"?: GjiHookCommand;
	/** The current worktree switched to another branch in place. */
	"after-switch"?: GjiHookCommand;
	/** A linked worktree is about to be removed. */
	"before-remove"?: GjiHookCommand;
}

export interface HookContext {
	branch?: string;
	path: string;
	repo: string;
	slot?: number | null;
}
