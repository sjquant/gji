import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';

const originalShell = process.env.SHELL;

afterEach(() => {
  if (originalShell === undefined) {
    delete process.env.SHELL;
  } else {
    process.env.SHELL = originalShell;
  }
});

describe('gji completion', () => {
  it('prints zsh completions explicitly', async () => {
    // Given a command output collector.
    const stdout: string[] = [];

    // When gji completion runs for zsh explicitly.
    const result = await runCli(['completion', 'zsh'], {
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the zsh completion definition without the init wrapper.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toContain("'completion:print shell completion definitions'");
    expect(stdout.join('')).toContain("'2:shell:(bash fish zsh)'");
    expect(stdout.join('')).toContain("'2:branch:->worktrees'");
    expect(stdout.join('')).toContain("'2:action:(get set unset)' '3:key:->config_keys' '4:value: '");
    expect(stdout.join('')).toContain('__gji_worktree_branches() {');
    expect(stdout.join('')).toContain('compdef _gji_completion gji');
    expect(stdout.join('')).not.toContain('# >>> gji init >>>');
    expect(stdout.join('')).not.toContain('gji() {');
  });

  it('auto-detects the shell from SHELL when no shell is provided', async () => {
    // Given a fish SHELL environment and a command output collector.
    const stdout: string[] = [];
    process.env.SHELL = '/opt/homebrew/bin/fish';

    // When gji completion runs without an explicit shell argument.
    const result = await runCli(['completion'], {
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it prints the detected fish completion definition.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toContain('function __gji_worktree_branches');
    expect(stdout.join('')).toContain("complete -c gji -n '__fish_seen_subcommand_from completion' -a 'zsh'");
    expect(stdout.join('')).toContain("complete -c gji -n '__fish_use_subcommand' -a 'new'");
  });
});
