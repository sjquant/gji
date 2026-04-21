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
    expect(stdout.join('')).toContain("_values 'config action' get set unset");
    expect(stdout.join('')).toContain(`case "\${words[3]}" in`);
    expect(stdout.join('')).toContain("get|unset)");
    expect(stdout.join('')).toContain("_arguments '3:key:->config_keys'");
    expect(stdout.join('')).toContain("set)");
    expect(stdout.join('')).toContain("_arguments '3:key:->config_keys' '4:value: '");
    expect(stdout.join('')).not.toContain("'2:action:(get set unset)' '3:key:->config_keys' '4:value: '");
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
    expect(stdout.join('')).toContain('function __gji_should_complete_config_action');
    expect(stdout.join('')).toContain('function __gji_should_complete_config_key');
    expect(stdout.join('')).toContain('test (count $tokens) -eq 2');
    expect(stdout.join('')).toContain('if test (count $tokens) -ne 3');
    expect(stdout.join('')).toContain('if test $tokens[2] != config');
    expect(stdout.join('')).toContain('contains -- $tokens[3] get set unset');
    expect(stdout.join('')).toContain("complete -c gji -n '__fish_seen_subcommand_from config; and __gji_should_complete_config_action' -a 'get set unset' -d 'config action'");
    expect(stdout.join('')).toContain("complete -c gji -n '__gji_should_complete_config_key' -a 'branchPrefix' -d 'config key'");
    expect(stdout.join('')).not.toContain("__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set unset");
    expect(stdout.join('')).toContain("complete -c gji -n '__fish_use_subcommand' -a 'new'");
  });

  it('prints bash config completions with a separate free-form value slot', async () => {
    // Given a command output collector.
    const stdout: string[] = [];

    // When gji completion runs for bash explicitly.
    const result = await runCli(['completion', 'bash'], {
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then config completions only suggest keys in the key position.
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toContain('if [ "$COMP_CWORD" -eq 2 ]; then');
    expect(stdout.join('')).toContain('get|unset)');
    expect(stdout.join('')).toContain('set)');
    expect(stdout.join('')).toContain('if [ "$COMP_CWORD" -eq 3 ]; then');
    expect(stdout.join('')).not.toContain('get|set|unset)\n          COMPREPLY=( $(compgen -W');
  });
});
