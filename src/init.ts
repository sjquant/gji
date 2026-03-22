import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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

export interface InitCommandOptions {
  cwd: string;
  shell?: string;
  stderr?: (chunk: string) => void;
  stdout: (chunk: string) => void;
  write?: boolean;
}

export async function runInitCommand(options: InitCommandOptions): Promise<number> {
  const shell = resolveShell(options.shell, process.env.SHELL);

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

  const rcPath = resolveShellConfigPath(shell, homedir());
  await mkdir(dirname(rcPath), { recursive: true });

  const current = await readExistingConfig(rcPath);
  const next = upsertShellIntegration(current, script);
  await writeFile(rcPath, next, 'utf8');

  options.stdout(`${rcPath}\n`);
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
  ${command.envVar}="$output_file" command gji ${command.commandName} "$@" || { local status=$?; rm -f "$output_file"; return $status; }
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
