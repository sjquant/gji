import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { intro, isCancel, outro, select, text } from '@clack/prompts';

import { loadConfig, loadGlobalConfig, saveLocalConfig, updateGlobalConfigKey } from './config.js';

export type SupportedShell = 'bash' | 'fish' | 'zsh';

const START_MARKER = '# >>> gji init >>>';
const END_MARKER = '# <<< gji init <<<';

interface ShellWrappedCommand {
  bypassOption: '--help' | '--print';
  commandName: string;
  envVar: string;
  names: string[];
  tempPrefix: string;
}

const SHELL_WRAPPED_COMMANDS: ShellWrappedCommand[] = [
  {
    bypassOption: '--help',
    commandName: 'new',
    envVar: 'GJI_NEW_OUTPUT_FILE',
    names: ['new'],
    tempPrefix: 'gji-new',
  },
  {
    bypassOption: '--help',
    commandName: 'pr',
    envVar: 'GJI_PR_OUTPUT_FILE',
    names: ['pr'],
    tempPrefix: 'gji-pr',
  },
  {
    bypassOption: '--print',
    commandName: 'go',
    envVar: 'GJI_GO_OUTPUT_FILE',
    names: ['go'],
    tempPrefix: 'gji-go',
  },
  {
    bypassOption: '--print',
    commandName: 'root',
    envVar: 'GJI_ROOT_OUTPUT_FILE',
    names: ['root'],
    tempPrefix: 'gji-root',
  },
  {
    bypassOption: '--help',
    commandName: 'remove',
    envVar: 'GJI_REMOVE_OUTPUT_FILE',
    names: ['remove', 'rm'],
    tempPrefix: 'gji-remove',
  },
];

export type InstallSaveTarget = 'local' | 'global';

export interface SetupWizardResult {
  branchPrefix?: string;
  hooks?: {
    afterCreate?: string;
    afterEnter?: string;
    beforeRemove?: string;
  };
  installSaveTarget: InstallSaveTarget;
  worktreePath?: string;
}

export interface InitCommandOptions {
  cwd: string;
  home?: string;
  promptForSetup?: () => Promise<SetupWizardResult | null>;
  shell?: string;
  stderr?: (chunk: string) => void;
  stdout: (chunk: string) => void;
  write?: boolean;
}

export async function runInitCommand(options: InitCommandOptions): Promise<number> {
  const shell = resolveShell(options.shell, process.env.SHELL);
  const home = options.home ?? homedir();

  if (!shell) {
    options.stderr?.(
      'Unable to detect a supported shell. Specify one explicitly: bash, fish, or zsh.\n',
    );
    return 1;
  }

  const script = renderShellIntegration(shell);

  if (!options.write) {
    options.stdout(script);
    return 0;
  }

  const rcPath = resolveShellConfigPath(shell, home);
  await mkdir(dirname(rcPath), { recursive: true });

  const current = await readExistingConfig(rcPath);
  const next = upsertShellIntegration(current, script);
  await writeFile(rcPath, next, 'utf8');

  options.stdout(`${rcPath}\n`);

  // Run the setup wizard on the first-ever init (not on subsequent re-runs).
  const { config: globalConfig } = await loadGlobalConfig(home);
  const alreadyConfigured =
    'shellIntegration' in globalConfig || 'installSaveTarget' in globalConfig;
  const hasCustomPrompt = options.promptForSetup !== undefined;
  const canPrompt = hasCustomPrompt || process.stdout.isTTY === true;

  if (!alreadyConfigured && canPrompt) {
    const prompt = options.promptForSetup ?? defaultPromptForSetup;
    const result = await prompt();
    if (result) {
      await updateGlobalConfigKey('installSaveTarget', result.installSaveTarget, home);
      await saveWizardConfig(result, options.cwd, home);
    }
  }

  // Mark shell integration as installed so the first-run nudge is suppressed.
  await updateGlobalConfigKey('shellIntegration', true, home);

  return 0;
}

export function renderShellIntegration(shell: SupportedShell): string {
  const commandBlocks = SHELL_WRAPPED_COMMANDS.map((command) =>
    shell === 'fish' ? renderFishWrapper(command) : renderPosixWrapper(command),
  ).join('\n\n');

  switch (shell) {
    case 'fish':
      return `${START_MARKER}
function gji --wraps gji --description 'gji shell integration'
${indentBlock(commandBlocks, 4)}

    command gji $argv
end
${END_MARKER}
`;
    case 'bash':
    case 'zsh':
      return `${START_MARKER}
gji() {
${indentBlock(commandBlocks, 2)}

  command gji "$@"
}
${END_MARKER}
`;
  }
}

export function upsertShellIntegration(existingConfig: string, script: string): string {
  const trimmedScript = script.trimEnd();
  const blockPattern = new RegExp(
    `${escapeForRegExp(START_MARKER)}[\\s\\S]*?${escapeForRegExp(END_MARKER)}\\n?`,
    'm',
  );

  if (blockPattern.test(existingConfig)) {
    return ensureTrailingNewline(
      existingConfig.replace(blockPattern, `${trimmedScript}\n`),
    );
  }

  const prefix = existingConfig.trimEnd();

  if (prefix.length === 0) {
    return ensureTrailingNewline(trimmedScript);
  }

  return ensureTrailingNewline(`${prefix}\n\n${trimmedScript}`);
}

async function saveWizardConfig(
  result: SetupWizardResult,
  cwd: string,
  home: string,
): Promise<void> {
  const values: Record<string, unknown> = {};

  if (result.branchPrefix) values.branchPrefix = result.branchPrefix;
  if (result.worktreePath) values.worktreePath = result.worktreePath;

  const hooks: Record<string, string> = {};
  if (result.hooks?.afterCreate) hooks.afterCreate = result.hooks.afterCreate;
  if (result.hooks?.afterEnter) hooks.afterEnter = result.hooks.afterEnter;
  if (result.hooks?.beforeRemove) hooks.beforeRemove = result.hooks.beforeRemove;
  if (Object.keys(hooks).length > 0) values.hooks = hooks;

  if (Object.keys(values).length === 0) return;

  if (result.installSaveTarget === 'local') {
    const loaded = await loadConfig(cwd);
    await saveLocalConfig(cwd, { ...loaded.config, ...values });
  } else {
    for (const [key, value] of Object.entries(values)) {
      await updateGlobalConfigKey(key, value, home);
    }
  }
}

function resolveShell(
  requestedShell: string | undefined,
  detectedShell: string | undefined,
): SupportedShell | null {
  const requested = normalizeShell(requestedShell);

  if (requested) {
    return requested;
  }

  return normalizeShell(detectedShell);
}

function normalizeShell(value: string | undefined): SupportedShell | null {
  if (!value) {
    return null;
  }

  const candidate = value.split('/').at(-1)?.toLowerCase();

  switch (candidate) {
    case 'bash':
    case 'fish':
    case 'zsh':
      return candidate;
    default:
      return null;
  }
}

function resolveShellConfigPath(shell: SupportedShell, home: string): string {
  switch (shell) {
    case 'bash':
      return join(home, '.bashrc');
    case 'fish':
      return join(home, '.config', 'fish', 'config.fish');
    case 'zsh':
      return join(home, '.zshrc');
  }
}

async function readExistingConfig(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return '';
    }

    throw error;
  }
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function renderFishWrapper(command: ShellWrappedCommand): string {
  const tests = command.names.map((name) => `test $argv[1] = ${name}`).join('; or ');

  return `if test (count $argv) -gt 0; and ${tests}
    set -e argv[1]
    if test (count $argv) -gt 0; and test $argv[1] = ${command.bypassOption}
        command gji ${command.commandName} $argv
        return $status
    end

    set -l output_file (mktemp -t ${command.tempPrefix}.XXXXXX)
    or return 1
    env ${command.envVar}=$output_file command gji ${command.commandName} $argv
    or begin
        set -l status_code $status
        rm -f $output_file
        return $status_code
    end
    set -l target (cat $output_file)
    rm -f $output_file
    cd $target
    return $status
end`;
}

function renderPosixWrapper(command: ShellWrappedCommand): string {
  const tests = command.names.map((name) => `[ "$1" = "${name}" ]`).join(' || ');

  return `if ${tests}; then
  shift
  if [ "\${1:-}" = "${command.bypassOption}" ]; then
    command gji ${command.commandName} "$@"
    return $?
  fi

  local target
  local output_file
  output_file="$(mktemp -t ${command.tempPrefix}.XXXXXX)" || return 1
  ${command.envVar}="$output_file" command gji ${command.commandName} "$@" || { local exit_code=$?; rm -f "$output_file"; return $exit_code; }
  target="$(cat "$output_file")"
  rm -f "$output_file"
  cd "$target" || return $?
  return 0
fi`;
}

function indentBlock(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);

  return value
    .split('\n')
    .map((line) => line.length === 0 ? '' : `${prefix}${line}`)
    .join('\n');
}

async function defaultPromptForSetup(): Promise<SetupWizardResult | null> {
  intro('gji setup');

  const installSaveTarget = await select<InstallSaveTarget>({
    message: 'Where should preferences be saved?',
    options: [
      { value: 'global', label: '~/.config/gji/config.json', hint: 'personal — never committed' },
      { value: 'local', label: '.gji.json', hint: 'repo — committed with the project' },
    ],
  });

  if (isCancel(installSaveTarget)) {
    outro('Setup skipped.');
    return null;
  }

  const branchPrefix = await text({
    message: 'Default branch prefix?',
    placeholder: 'e.g. feat/ or fix/ — leave blank to skip',
  });

  if (isCancel(branchPrefix)) {
    outro('Setup skipped.');
    return null;
  }

  const worktreePath = await text({
    message: 'Worktree base path?',
    placeholder: 'leave blank to use the default path',
  });

  if (isCancel(worktreePath)) {
    outro('Setup skipped.');
    return null;
  }

  const afterCreate = await text({
    message: 'afterCreate hook — run after creating a worktree?',
    placeholder: 'e.g. pnpm install — leave blank to skip',
  });

  if (isCancel(afterCreate)) {
    outro('Setup skipped.');
    return null;
  }

  const afterEnter = await text({
    message: 'afterEnter hook — run after entering a worktree?',
    placeholder: 'e.g. nvm use — leave blank to skip',
  });

  if (isCancel(afterEnter)) {
    outro('Setup skipped.');
    return null;
  }

  const beforeRemove = await text({
    message: 'beforeRemove hook — run before removing a worktree?',
    placeholder: 'leave blank to skip',
  });

  if (isCancel(beforeRemove)) {
    outro('Setup skipped.');
    return null;
  }

  outro('Setup complete!');

  const hooks: SetupWizardResult['hooks'] = {};
  if (afterCreate) hooks.afterCreate = afterCreate;
  if (afterEnter) hooks.afterEnter = afterEnter;
  if (beforeRemove) hooks.beforeRemove = beforeRemove;

  return {
    branchPrefix: branchPrefix || undefined,
    hooks: Object.keys(hooks).length > 0 ? hooks : undefined,
    installSaveTarget,
    worktreePath: worktreePath || undefined,
  };
}
