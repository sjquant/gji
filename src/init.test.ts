import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { GLOBAL_CONFIG_FILE_PATH } from './config.js';
import { runInitCommand } from './init.js';

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

describe('gji init --write setup wizard', () => {
  it('saves installSaveTarget and config values to global config', async () => {
    // Given an isolated home with no existing global config.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));

    // When gji init --write runs and the wizard returns global preferences.
    const result = await runInitCommand({
      cwd,
      home,
      shell: 'zsh',
      write: true,
      stdout: () => undefined,
      promptForSetup: async () => ({
        installSaveTarget: 'global',
        branchPrefix: 'feat/',
        worktreePath: '~/worktrees',
        hooks: { afterCreate: 'pnpm install' },
      }),
    });

    // Then the values are written to global config.
    expect(result).toBe(0);
    const globalConfig = JSON.parse(
      await readFile(GLOBAL_CONFIG_FILE_PATH(home), 'utf8'),
    ) as Record<string, unknown>;
    expect(globalConfig.installSaveTarget).toBe('global');
    expect(globalConfig.branchPrefix).toBe('feat/');
    expect(globalConfig.worktreePath).toBe('~/worktrees');
    expect(globalConfig.hooks).toEqual({ afterCreate: 'pnpm install' });
    expect(globalConfig.shellIntegration).toBe(true);
  });

  it('saves config values to local .gji.json when installSaveTarget is local', async () => {
    // Given an isolated home and cwd.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));

    // When the wizard chooses local save target with a branch prefix.
    await runInitCommand({
      cwd,
      home,
      shell: 'zsh',
      write: true,
      stdout: () => undefined,
      promptForSetup: async () => ({
        installSaveTarget: 'local',
        branchPrefix: 'fix/',
      }),
    });

    // Then branchPrefix is written to the local .gji.json.
    const localConfig = JSON.parse(
      await readFile(join(cwd, '.gji.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(localConfig.branchPrefix).toBe('fix/');
  });

  it('skips the wizard when shell integration is already configured', async () => {
    // Given a home where a previous gji init --write already ran.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));
    let wizardCallCount = 0;

    // First run sets shellIntegration: true.
    await runInitCommand({
      cwd,
      home,
      shell: 'zsh',
      write: true,
      stdout: () => undefined,
      promptForSetup: async () => { wizardCallCount++; return { installSaveTarget: 'global' }; },
    });

    // Second run should skip the wizard.
    await runInitCommand({
      cwd,
      home,
      shell: 'zsh',
      write: true,
      stdout: () => undefined,
      promptForSetup: async () => { wizardCallCount++; return { installSaveTarget: 'global' }; },
    });

    // Then the wizard was only called once (on first init).
    expect(wizardCallCount).toBe(1);
  });

  it('skips the wizard when not in --write mode', async () => {
    // Given an init run without --write (print-to-stdout mode).
    let wizardCalled = false;
    const stdout: string[] = [];

    // When gji init runs without --write.
    const result = await runInitCommand({
      cwd: '/tmp',
      home: '/tmp',
      shell: 'zsh',
      stdout: (chunk) => stdout.push(chunk),
      promptForSetup: async () => { wizardCalled = true; return { installSaveTarget: 'global' }; },
    });

    // Then the shell script is printed and the wizard is not called.
    expect(result).toBe(0);
    expect(wizardCalled).toBe(false);
    expect(stdout.join('')).toContain('gji init');
  });

  it('does not save anything when the wizard is cancelled', async () => {
    // Given an isolated home with no existing global config.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));

    // When the wizard is cancelled (returns null).
    await runInitCommand({
      cwd,
      home,
      shell: 'zsh',
      write: true,
      stdout: () => undefined,
      promptForSetup: async () => null,
    });

    // Then no config values are written (only shellIntegration is set).
    const globalConfig = JSON.parse(
      await readFile(GLOBAL_CONFIG_FILE_PATH(home), 'utf8'),
    ) as Record<string, unknown>;
    expect('installSaveTarget' in globalConfig).toBe(false);
    expect(globalConfig.shellIntegration).toBe(true);
  });

  it('sets shellIntegration: true in global config after writing', async () => {
    // Given an isolated home with no existing global config.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));

    // When gji init --write runs (no wizard needed).
    await runInitCommand({
      cwd,
      home,
      shell: 'zsh',
      write: true,
      stdout: () => undefined,
      promptForSetup: async () => null,
    });

    // Then shellIntegration is marked as true.
    const globalConfig = JSON.parse(
      await readFile(GLOBAL_CONFIG_FILE_PATH(home), 'utf8'),
    ) as Record<string, unknown>;
    expect(globalConfig.shellIntegration).toBe(true);
  });
});

function expectedZshIntegration(): string {
  return `# >>> gji init >>>
gji() {
  if [ "$1" = "new" ]; then
    shift
    if [ "\${1:-}" = "--help" ]; then
      command gji new "$@"
      return $?
    fi

    local target
    local output_file
    output_file="$(mktemp -t gji-new.XXXXXX)" || return 1
    GJI_NEW_OUTPUT_FILE="$output_file" command gji new "$@" || { local exit_code=$?; rm -f "$output_file"; return $exit_code; }
    target="$(cat "$output_file")"
    rm -f "$output_file"
    cd "$target" || return $?
    return 0
  fi

  if [ "$1" = "pr" ]; then
    shift
    if [ "\${1:-}" = "--help" ]; then
      command gji pr "$@"
      return $?
    fi

    local target
    local output_file
    output_file="$(mktemp -t gji-pr.XXXXXX)" || return 1
    GJI_PR_OUTPUT_FILE="$output_file" command gji pr "$@" || { local exit_code=$?; rm -f "$output_file"; return $exit_code; }
    target="$(cat "$output_file")"
    rm -f "$output_file"
    cd "$target" || return $?
    return 0
  fi

  if [ "$1" = "go" ]; then
    shift
    if [ "\${1:-}" = "--print" ]; then
      command gji go "$@"
      return $?
    fi

    local target
    local output_file
    output_file="$(mktemp -t gji-go.XXXXXX)" || return 1
    GJI_GO_OUTPUT_FILE="$output_file" command gji go "$@" || { local exit_code=$?; rm -f "$output_file"; return $exit_code; }
    target="$(cat "$output_file")"
    rm -f "$output_file"
    cd "$target" || return $?
    return 0
  fi

  if [ "$1" = "root" ]; then
    shift
    if [ "\${1:-}" = "--print" ]; then
      command gji root "$@"
      return $?
    fi

    local target
    local output_file
    output_file="$(mktemp -t gji-root.XXXXXX)" || return 1
    GJI_ROOT_OUTPUT_FILE="$output_file" command gji root "$@" || { local exit_code=$?; rm -f "$output_file"; return $exit_code; }
    target="$(cat "$output_file")"
    rm -f "$output_file"
    cd "$target" || return $?
    return 0
  fi

  if [ "$1" = "remove" ] || [ "$1" = "rm" ]; then
    shift
    if [ "\${1:-}" = "--help" ]; then
      command gji remove "$@"
      return $?
    fi

    local target
    local output_file
    output_file="$(mktemp -t gji-remove.XXXXXX)" || return 1
    GJI_REMOVE_OUTPUT_FILE="$output_file" command gji remove "$@" || { local exit_code=$?; rm -f "$output_file"; return $exit_code; }
    target="$(cat "$output_file")"
    rm -f "$output_file"
    cd "$target" || return $?
    return 0
  fi

  command gji "$@"
}
# <<< gji init <<<
`;
}
