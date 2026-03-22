import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';

const originalHome = process.env.HOME;
const originalShell = process.env.SHELL;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  if (originalShell === undefined) {
    delete process.env.SHELL;
  } else {
    process.env.SHELL = originalShell;
  }
});

describe('gji init', () => {
  it('prints zsh integration code explicitly', async () => {
    // Given a command output collector.
    const stdout: string[] = [];

    // When gji init runs for zsh explicitly.
    const result = await runCli(['init', 'zsh'], {
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the shell integration wrapper.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(expectedZshIntegration());
  });

  it('auto-detects the shell from SHELL when no shell is provided', async () => {
    // Given a zsh SHELL environment and a command output collector.
    const stdout: string[] = [];
    process.env.SHELL = '/bin/zsh';

    // When gji init runs without an explicit shell argument.
    const result = await runCli(['init'], {
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the detected shell integration wrapper.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toBe(expectedZshIntegration());
  });

  it('writes zsh integration to the shell rc file with --write', async () => {
    // Given an isolated home directory and working directory.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    process.env.HOME = home;
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));

    // When gji init writes the zsh integration to disk.
    const result = await runCli(['init', 'zsh', '--write'], { cwd });

    // Then the zsh rc file contains the integration wrapper.
    expect(result.exitCode).toBe(0);
    await expect(readFile(join(home, '.zshrc'), 'utf8')).resolves.toBe(expectedZshIntegration());
  });

  it('does not duplicate the zsh integration block when --write runs twice', async () => {
    // Given an isolated home directory and working directory.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    process.env.HOME = home;
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));

    // When gji init writes the zsh integration twice.
    expect((await runCli(['init', 'zsh', '--write'], { cwd })).exitCode).toBe(0);
    expect((await runCli(['init', 'zsh', '--write'], { cwd })).exitCode).toBe(0);

    // Then the shell config contains only one integration block.
    const content = await readFile(join(home, '.zshrc'), 'utf8');

    expect(content.match(/# >>> gji init >>>/g)).toHaveLength(1);
    expect(content.match(/# <<< gji init <<</g)).toHaveLength(1);
  });
});

function expectedZshIntegration(): string {
  return `# >>> gji init >>>
gji() {
  if [ "$1" = "go" ]; then
    shift
    if [ "\${1:-}" = "--print" ]; then
      command gji go "$@"
      return $?
    fi

    local target
    local output
    output="$(GJI_GO_TTY_PROMPT=1 command gji go --print "$@")" || return $?
    target="\${output##*__GJI_TARGET__:}"
    cd "$target" || return $?
    return 0
  fi

  command gji "$@"
}
# <<< gji init <<<
`;
}
