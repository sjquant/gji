import { spawn } from "node:child_process";

export type GjiHookCommand = string | string[];

export interface GjiHooks {
	afterCreate?: GjiHookCommand;
	afterEnter?: GjiHookCommand;
	beforeRemove?: GjiHookCommand;
}

export interface HookContext {
	branch?: string;
	path: string;
	repo: string;
}

export async function runHook(
	hookCmd: GjiHookCommand | undefined,
	cwd: string,
	context: HookContext,
	stderr: (chunk: string) => void,
): Promise<void> {
	if (!hookCmd) return;

	if (Array.isArray(hookCmd)) {
		await runArgvHook(hookCmd, cwd, context, stderr);
		return;
	}

	await runShellHook(hookCmd, cwd, context, stderr);
}

async function runArgvHook(
	hookCmd: string[],
	cwd: string,
	context: HookContext,
	stderr: (chunk: string) => void,
): Promise<void> {
	const [command, ...args] = hookCmd.map((arg) => interpolate(arg, context));
	if (!command) {
		stderr("gji: hook argv command must include a non-empty command\n");
		return;
	}

	await new Promise<void>((resolve) => {
		const child = spawn(command, args, {
			cwd,
			shell: false,
			stdio: ["ignore", "inherit", "pipe"],
			env: hookEnvironment(context),
		});

		(child.stderr as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
			stderr(chunk.toString());
		});

		child.on("close", (code) => {
			if (code !== 0) {
				stderr(
					`gji: hook exited with code ${code}: ${formatArgvHook(command, args)}\n`,
				);
			}
			resolve();
		});

		child.on("error", (err) => {
			stderr(`gji: hook failed to start: ${err.message}\n`);
			resolve();
		});
	});
}

async function runShellHook(
	hookCmd: string,
	cwd: string,
	context: HookContext,
	stderr: (chunk: string) => void,
): Promise<void> {
	const interpolated = interpolate(hookCmd, context);

	await new Promise<void>((resolve) => {
		const child = spawn(interpolated, {
			cwd,
			shell: true,
			stdio: ["ignore", "inherit", "pipe"],
			env: hookEnvironment(context),
		});

		(child.stderr as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
			stderr(chunk.toString());
		});

		child.on("close", (code) => {
			if (code !== 0) {
				stderr(`gji: hook exited with code ${code}: ${interpolated}\n`);
			}
			resolve();
		});

		child.on("error", (err) => {
			stderr(`gji: hook failed to start: ${err.message}\n`);
			resolve();
		});
	});
}

function hookEnvironment(context: HookContext): NodeJS.ProcessEnv {
	return {
		...process.env,
		GJI_BRANCH: context.branch ?? "",
		GJI_PATH: context.path,
		GJI_REPO: context.repo,
	};
}

function formatArgvHook(command: string, args: string[]): string {
	return JSON.stringify([command, ...args]);
}

export function interpolate(template: string, context: HookContext): string {
	return template
		.replace(/\{\{branch\}\}/g, context.branch ?? "")
		.replace(/\{\{path\}\}/g, context.path)
		.replace(/\{\{repo\}\}/g, context.repo);
}

export function extractHooks(config: Record<string, unknown>): GjiHooks {
	const raw = config.hooks;

	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return {};
	}

	const hooks = raw as Record<string, unknown>;

	return {
		afterCreate: parseHookCommand(hooks.afterCreate),
		afterEnter: parseHookCommand(hooks.afterEnter),
		beforeRemove: parseHookCommand(hooks.beforeRemove),
	};
}

function parseHookCommand(value: unknown): GjiHookCommand | undefined {
	if (typeof value === "string") return value;
	if (
		Array.isArray(value) &&
		value.length > 0 &&
		value[0] !== "" &&
		value.every((item) => typeof item === "string")
	) {
		return value;
	}

	return undefined;
}
