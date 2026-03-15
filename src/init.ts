import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type SupportedShell = 'bash' | 'fish' | 'zsh';

const START_MARKER = '# >>> gji init >>>';
const END_MARKER = '# <<< gji init <<<';

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
  switch (shell) {
    case 'fish':
      return `${START_MARKER}
function gji --wraps gji --description 'gji shell integration'
    if test (count $argv) -gt 0; and test $argv[1] = go
        set -e argv[1]
        if test (count $argv) -gt 0; and test $argv[1] = --print
            command gji go $argv
            return $status
        end

        set -l target (command gji go --print $argv)
        or return $status
        cd $target
        return $status
    end

    command gji $argv
end
${END_MARKER}
`;
    case 'bash':
    case 'zsh':
      return `${START_MARKER}
gji() {
  if [ "$1" = "go" ]; then
    shift
    if [ "\${1:-}" = "--print" ]; then
      command gji go "$@"
      return $?
    fi

    local target
    target="$(command gji go --print "$@")" || return $?
    cd "$target" || return $?
    return 0
  fi

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
