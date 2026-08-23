export type GjiHookCommand = string | string[];

export interface GjiHooks {
	"after-create"?: GjiHookCommand;
	"after-enter"?: GjiHookCommand;
	"before-remove"?: GjiHookCommand;
}

export interface HookContext {
	branch?: string;
	path: string;
	repo: string;
	slot?: number | null;
}
