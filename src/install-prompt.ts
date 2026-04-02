import { spawn } from 'node:child_process';
import { isCancel, select } from '@clack/prompts';

import { type GjiConfig, loadConfig, updateLocalConfigKey } from './config.js';
import { detectPackageManager, type PackageManager } from './package-manager.js';

export type InstallChoice = 'yes' | 'no' | 'always' | 'never';

export interface InstallPromptDependencies {
  detectInstallPackageManager?: (root: string) => Promise<PackageManager | null>;
  promptForInstallChoice?: (pm: PackageManager) => Promise<InstallChoice | null>;
  runInstallCommand?: (command: string, cwd: string) => Promise<void>;
  writeConfigKey?: (root: string, key: string, value: unknown) => Promise<void>;
}

export async function maybeRunInstallPrompt(
  worktreePath: string,
  repoRoot: string,
  config: GjiConfig,
  stderr: (chunk: string) => void,
  deps: InstallPromptDependencies = {},
): Promise<void> {
  // Skip if afterCreate hook is already configured in effective config.
  const hooks = config.hooks;
  if (
    typeof hooks === 'object' &&
    hooks !== null &&
    !Array.isArray(hooks) &&
    typeof (hooks as Record<string, unknown>).afterCreate === 'string' &&
    ((hooks as Record<string, unknown>).afterCreate as string).length > 0
  ) {
    return;
  }

  // Skip if user has permanently opted out of install prompts.
  if (config.skipInstallPrompt === true) {
    return;
  }

  const detect = deps.detectInstallPackageManager ?? detectPackageManager;
  const pm = await detect(worktreePath);

  if (!pm) {
    return;
  }

  const prompt = deps.promptForInstallChoice ?? defaultPromptForInstallChoice;
  const choice = await prompt(pm);

  if (!choice || choice === 'no') {
    return;
  }

  if (choice === 'yes' || choice === 'always') {
    const runner = deps.runInstallCommand ?? ((cmd, cwd) => defaultRunInstallCommand(cmd, cwd, stderr));
    try {
      await runner(pm.installCommand, worktreePath);
    } catch (error) {
      stderr(`Warning: install command failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  const writeKey = deps.writeConfigKey ?? (async (root, key, value) => { await updateLocalConfigKey(root, key, value); });

  if (choice === 'always') {
    try {
      // Read local config hooks to deep-merge so other hook keys (e.g. afterEnter) are preserved.
      const { config: localConfig } = await loadConfig(repoRoot);
      const existingLocalHooks =
        typeof localConfig.hooks === 'object' &&
        localConfig.hooks !== null &&
        !Array.isArray(localConfig.hooks)
          ? (localConfig.hooks as Record<string, unknown>)
          : {};
      await writeKey(repoRoot, 'hooks', { ...existingLocalHooks, afterCreate: pm.installCommand });
    } catch (error) {
      stderr(`Warning: failed to save config: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  if (choice === 'never') {
    try {
      await writeKey(repoRoot, 'skipInstallPrompt', true);
    } catch (error) {
      stderr(`Warning: failed to save config: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}

async function defaultRunInstallCommand(
  command: string,
  cwd: string,
  stderr: (chunk: string) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'inherit', 'pipe'] });

    (child.stderr as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
      stderr(chunk.toString());
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`exited with code ${code}`));
      } else {
        resolve();
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function defaultPromptForInstallChoice(pm: PackageManager): Promise<InstallChoice | null> {
  const choice = await select({
    message: `Run \`${pm.installCommand}\` in the new worktree?`,
    options: [
      { value: 'yes', label: 'Yes', hint: 'run once' },
      { value: 'no', label: 'No', hint: 'skip this time' },
      { value: 'always', label: 'Always', hint: 'save as afterCreate hook' },
      { value: 'never', label: 'Never', hint: 'disable this prompt for this repo' },
    ],
  });

  if (isCancel(choice)) {
    return null;
  }

  return choice as InstallChoice;
}
