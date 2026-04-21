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

    // Then it prints the shell integration wrapper without bundled completions.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toContain('# >>> gji init >>>');
    expect(stdout.join('')).toContain('gji() {');
    expect(stdout.join('')).not.toContain('__gji_worktree_branches() {');
    expect(stdout.join('')).not.toContain('compdef _gji_completion gji');
    expect(stdout.join('')).toContain('# <<< gji init <<<');
  });

  it('auto-detects the shell from SHELL when no shell is provided', async () => {
    // Given a zsh SHELL environment and a command output collector.
    const stdout: string[] = [];
    process.env.SHELL = '/bin/zsh';

    // When gji init runs without an explicit shell argument.
    const result = await runCli(['init'], {
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the detected shell integration wrapper without bundled completions.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toContain('gji() {');
    expect(stdout.join('')).not.toContain('compdef _gji_completion gji');
  });

  it('writes zsh integration to the shell rc file with --write', async () => {
    // Given an isolated home directory and working directory.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    process.env.HOME = home;
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));

    // When gji init writes the zsh integration to disk.
    const result = await runCli(['init', 'zsh', '--write'], { cwd });

    // Then the zsh rc file contains the integration wrapper without completions.
    expect(result.exitCode).toBe(0);
    await expect(readFile(join(home, '.zshrc'), 'utf8')).resolves.not.toContain('compdef _gji_completion gji');
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

  it('prints bash integration without bundling bash completions', async () => {
    // Given a command output collector.
    const stdout: string[] = [];

    // When gji init runs for bash explicitly.
    const result = await runCli(['init', 'bash'], {
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the script contains only the bash wrapper code.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).not.toContain('_gji_completion() {');
    expect(stdout.join('')).not.toContain('complete -F _gji_completion gji');
  });

  it('prints fish integration without bundling fish completions', async () => {
    // Given a command output collector.
    const stdout: string[] = [];

    // When gji init runs for fish explicitly.
    const result = await runCli(['init', 'fish'], {
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the script contains only the fish wrapper code.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).not.toContain('function __gji_worktree_branches');
    expect(stdout.join('')).not.toContain("complete -c gji -n '__fish_use_subcommand' -a 'new'");
  });
});

describe('gji init --write preferences prompt', () => {
  it('saves the chosen installSaveTarget to global config after writing the shell integration', async () => {
    // Given an isolated home with no existing global config.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    process.env.HOME = home;
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));

    // When gji init --write runs and the user chooses "global".
    const result = await runInitCommand({
      cwd,
      home,
      shell: 'zsh',
      write: true,
      stdout: () => undefined,
      promptForInstallSaveTarget: async () => 'global',
    });

    // Then installSaveTarget: "global" is written to global config.
    expect(result).toBe(0);
    const globalConfig = JSON.parse(
      await readFile(GLOBAL_CONFIG_FILE_PATH(home), 'utf8'),
    ) as Record<string, unknown>;
    expect(globalConfig.installSaveTarget).toBe('global');
  });

  it('skips the preferences prompt when installSaveTarget is already configured', async () => {
    // Given a global config that already has installSaveTarget set.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    process.env.HOME = home;
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));
    let promptCalled = false;

    // Pre-populate the global config.
    await runInitCommand({
      cwd,
      home,
      shell: 'zsh',
      write: true,
      stdout: () => undefined,
      promptForInstallSaveTarget: async () => 'local',
    });

    // When gji init --write runs again.
    await runInitCommand({
      cwd,
      home,
      shell: 'zsh',
      write: true,
      stdout: () => undefined,
      promptForInstallSaveTarget: async () => { promptCalled = true; return 'global'; },
    });

    // Then the prompt was not shown a second time.
    expect(promptCalled).toBe(false);
  });

  it('skips the preferences prompt when not in --write mode', async () => {
    // Given an init run without --write (print-to-stdout mode).
    let promptCalled = false;
    const stdout: string[] = [];

    // When gji init runs without --write.
    const result = await runInitCommand({
      cwd: '/tmp',
      home: '/tmp',
      shell: 'zsh',
      stdout: (chunk) => stdout.push(chunk),
      promptForInstallSaveTarget: async () => { promptCalled = true; return 'global'; },
    });

    // Then the shell script is printed and no preference prompt appears.
    expect(result).toBe(0);
    expect(promptCalled).toBe(false);
    expect(stdout.join('')).toContain('gji init');
  });

  it('does not save anything when the preferences prompt is cancelled', async () => {
    // Given an isolated home with no existing global config.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    process.env.HOME = home;
    const cwd = await mkdtemp(join(tmpdir(), 'gji-cwd-'));

    // When the user cancels the preferences prompt (returns null).
    await runInitCommand({
      cwd,
      home,
      shell: 'zsh',
      write: true,
      stdout: () => undefined,
      promptForInstallSaveTarget: async () => null,
    });

    // Then no installSaveTarget is written to global config (file may not exist at all).
    let globalConfig: Record<string, unknown> = {};
    try {
      globalConfig = JSON.parse(await readFile(GLOBAL_CONFIG_FILE_PATH(home), 'utf8')) as Record<string, unknown>;
    } catch {
      // File was never created — that's fine, installSaveTarget is absent either way.
    }
    expect('installSaveTarget' in globalConfig).toBe(false);
  });
});
