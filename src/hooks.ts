import { spawn } from 'node:child_process';

export interface GjiHooks {
  afterNew?: string;
  afterGo?: string;
  beforeRemove?: string;
}

export interface HookContext {
  branch?: string;
  path: string;
  repo: string;
}

export async function runHook(
  hookCmd: string | undefined,
  cwd: string,
  context: HookContext,
  stderr: (chunk: string) => void,
): Promise<void> {
  if (!hookCmd) return;

  const interpolated = interpolate(hookCmd, context);

  await new Promise<void>((resolve) => {
    const child = spawn(interpolated, {
      cwd,
      shell: true,
      stdio: ['ignore', 'inherit', 'pipe'],
    });

    (child.stderr as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
      stderr(chunk.toString());
    });

    child.on('close', (code) => {
      if (code !== 0) {
        stderr(`gji: hook exited with code ${code}: ${interpolated}\n`);
      }
      resolve();
    });

    child.on('error', (err) => {
      stderr(`gji: hook failed to start: ${err.message}\n`);
      resolve();
    });
  });
}

export function interpolate(template: string, context: HookContext): string {
  return template
    .replace(/\{\{branch\}\}/g, context.branch ?? '')
    .replace(/\{\{path\}\}/g, context.path)
    .replace(/\{\{repo\}\}/g, context.repo);
}

export function extractHooks(config: Record<string, unknown>): GjiHooks {
  const raw = config.hooks;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const hooks = raw as Record<string, unknown>;

  return {
    afterNew: typeof hooks.afterNew === 'string' ? hooks.afterNew : undefined,
    afterGo: typeof hooks.afterGo === 'string' ? hooks.afterGo : undefined,
    beforeRemove: typeof hooks.beforeRemove === 'string' ? hooks.beforeRemove : undefined,
  };
}
