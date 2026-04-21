const TOP_LEVEL_COMMANDS = [
  { name: 'new', description: 'create a new branch or detached linked worktree' },
  { name: 'init', description: 'print or install shell integration' },
  { name: 'completion', description: 'print shell completion definitions' },
  { name: 'pr', description: 'fetch a pull request into a linked worktree' },
  { name: 'go', description: 'print or select a worktree path' },
  { name: 'root', description: 'print the main repository root path' },
  { name: 'status', description: 'summarize repository and worktree health' },
  { name: 'sync', description: 'fetch and update one or all worktrees' },
  { name: 'ls', description: 'list active worktrees' },
  { name: 'clean', description: 'interactively prune linked worktrees' },
  { name: 'remove', description: 'remove a linked worktree and delete its branch when present' },
  { name: 'rm', description: 'alias of remove' },
  { name: 'trigger-hook', description: 'run a named hook in the current worktree' },
  { name: 'config', description: 'manage global config defaults' },
] as const;

const SHELL_NAMES = ['bash', 'fish', 'zsh'] as const;
const HOOK_NAMES = ['afterCreate', 'afterEnter', 'beforeRemove'] as const;
const CONFIG_KEYS = [
  'branchPrefix',
  'syncRemote',
  'syncDefaultBranch',
  'syncFiles',
  'skipInstallPrompt',
  'installSaveTarget',
  'hooks',
  'repos',
] as const;

export function renderShellCompletion(shell: 'bash' | 'fish' | 'zsh'): string {
  switch (shell) {
    case 'bash':
      return renderBashCompletion();
    case 'fish':
      return renderFishCompletion();
    case 'zsh':
      return renderZshCompletion();
  }
}

function renderBashCompletion(): string {
  const topLevelCommands = TOP_LEVEL_COMMANDS.map((command) => command.name).join(' ');
  const shells = SHELL_NAMES.join(' ');
  const hooks = HOOK_NAMES.join(' ');
  const configKeys = CONFIG_KEYS.join(' ');

  return `__gji_worktree_branches() {
  command gji ls 2>/dev/null | awk 'NR > 1 && $2 != "(detached)" { print $2 }'
}

_gji_completion() {
  local cur command_name
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]:-}"

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${topLevelCommands}" -- "$cur") )
    return 0
  fi

  command_name="\${COMP_WORDS[1]}"

  case "$command_name" in
    new)
      COMPREPLY=( $(compgen -W "--detached --dry-run --json --help" -- "$cur") )
      ;;
    init)
      COMPREPLY=( $(compgen -W "${shells} --write --help" -- "$cur") )
      ;;
    completion)
      COMPREPLY=( $(compgen -W "${shells} --help" -- "$cur") )
      ;;
    pr)
      COMPREPLY=( $(compgen -W "--dry-run --json --help" -- "$cur") )
      ;;
    go)
      COMPREPLY=( $(compgen -W "$(__gji_worktree_branches) --print --help" -- "$cur") )
      ;;
    root)
      COMPREPLY=( $(compgen -W "--print --help" -- "$cur") )
      ;;
    status)
      COMPREPLY=( $(compgen -W "--json --help" -- "$cur") )
      ;;
    sync)
      COMPREPLY=( $(compgen -W "--all --json --help" -- "$cur") )
      ;;
    ls)
      COMPREPLY=( $(compgen -W "--json --help" -- "$cur") )
      ;;
    clean)
      COMPREPLY=( $(compgen -W "-f --force --dry-run --json --help" -- "$cur") )
      ;;
    remove|rm)
      COMPREPLY=( $(compgen -W "$(__gji_worktree_branches) -f --force --dry-run --json --help" -- "$cur") )
      ;;
    trigger-hook)
      COMPREPLY=( $(compgen -W "${hooks} --help" -- "$cur") )
      ;;
    config)
      if [ "$COMP_CWORD" -eq 2 ]; then
        COMPREPLY=( $(compgen -W "get set unset" -- "$cur") )
        return 0
      fi

      case "\${COMP_WORDS[2]}" in
        get|unset)
          if [ "$COMP_CWORD" -eq 3 ]; then
            COMPREPLY=( $(compgen -W "${configKeys}" -- "$cur") )
          fi
          ;;
        set)
          if [ "$COMP_CWORD" -eq 3 ]; then
            COMPREPLY=( $(compgen -W "${configKeys}" -- "$cur") )
          fi
          ;;
      esac
      ;;
  esac
}

complete -F _gji_completion gji`;
}

function renderFishCompletion(): string {
  const commandLines = TOP_LEVEL_COMMANDS.map((command) =>
    `complete -c gji -n '__fish_use_subcommand' -a '${command.name}' -d '${escapeSingleQuotes(command.description)}'`,
  ).join('\n');

  const shellLines = SHELL_NAMES.map((shell) =>
    `complete -c gji -n '__fish_seen_subcommand_from init' -a '${shell}' -d 'shell'`,
  ).join('\n');

  const hookLines = HOOK_NAMES.map((hook) =>
    `complete -c gji -n '__fish_seen_subcommand_from trigger-hook' -a '${hook}' -d 'hook'`,
  ).join('\n');

  const configKeyLines = CONFIG_KEYS.map((key) =>
    `complete -c gji -n '__gji_should_complete_config_key' -a '${key}' -d 'config key'`,
  ).join('\n');

  return `function __gji_worktree_branches
    command gji ls 2>/dev/null | awk 'NR > 1 && $2 != "(detached)" { print $2 }'
end

function __gji_should_complete_config_action
    set -l tokens (commandline -opc)
    test (count $tokens) -eq 2
end

function __gji_should_complete_config_key
    set -l tokens (commandline -opc)
    if test (count $tokens) -ne 3
        return 1
    end

    if test $tokens[2] != config
        return 1
    end

    contains -- $tokens[3] get set unset
end

complete -c gji -f
${commandLines}

complete -c gji -n '__fish_seen_subcommand_from new' -l detached -d 'create a detached worktree without a branch'
complete -c gji -n '__fish_seen_subcommand_from new' -l dry-run -d 'show what would be created without executing any git commands or writing files'
complete -c gji -n '__fish_seen_subcommand_from new' -l json -d 'emit JSON on success or error instead of human-readable output'

complete -c gji -n '__fish_seen_subcommand_from init' -l write -d 'write the integration to the shell config file'
${shellLines}

complete -c gji -n '__fish_seen_subcommand_from completion' -a 'bash' -d 'shell'
complete -c gji -n '__fish_seen_subcommand_from completion' -a 'fish' -d 'shell'
complete -c gji -n '__fish_seen_subcommand_from completion' -a 'zsh' -d 'shell'

complete -c gji -n '__fish_seen_subcommand_from pr' -l dry-run -d 'show what would be created without executing any git commands or writing files'
complete -c gji -n '__fish_seen_subcommand_from pr' -l json -d 'emit JSON on success or error instead of human-readable output'

complete -c gji -n '__fish_seen_subcommand_from go' -l print -d 'print the resolved worktree path explicitly'
complete -c gji -n '__fish_seen_subcommand_from go' -a '(__gji_worktree_branches)' -d 'worktree branch'

complete -c gji -n '__fish_seen_subcommand_from root' -l print -d 'print the resolved repository root path explicitly'

complete -c gji -n '__fish_seen_subcommand_from status' -l json -d 'print repository and worktree health as JSON'

complete -c gji -n '__fish_seen_subcommand_from sync' -l all -d 'sync every worktree in the repository'
complete -c gji -n '__fish_seen_subcommand_from sync' -l json -d 'emit JSON on success or error instead of human-readable output'

complete -c gji -n '__fish_seen_subcommand_from ls' -l json -d 'print active worktrees as JSON'

complete -c gji -n '__fish_seen_subcommand_from clean' -s f -l force -d 'bypass prompts, force-remove dirty worktrees, and force-delete unmerged branches'
complete -c gji -n '__fish_seen_subcommand_from clean' -l dry-run -d 'show what would be deleted without removing anything'
complete -c gji -n '__fish_seen_subcommand_from clean' -l json -d 'emit JSON on success or error instead of human-readable output'

complete -c gji -n '__fish_seen_subcommand_from remove rm' -s f -l force -d 'bypass prompts, force-remove a dirty worktree, and force-delete an unmerged branch'
complete -c gji -n '__fish_seen_subcommand_from remove rm' -l dry-run -d 'show what would be deleted without removing anything'
complete -c gji -n '__fish_seen_subcommand_from remove rm' -l json -d 'emit JSON on success or error instead of human-readable output'
complete -c gji -n '__fish_seen_subcommand_from remove rm' -a '(__gji_worktree_branches)' -d 'worktree branch'

${hookLines}

complete -c gji -n '__fish_seen_subcommand_from config; and __gji_should_complete_config_action' -a 'get set unset' -d 'config action'
${configKeyLines}`;
}

function renderZshCompletion(): string {
  const commandLines = TOP_LEVEL_COMMANDS.map((command) =>
    `'${command.name}:${escapeSingleQuotes(command.description)}'`,
  ).join('\n    ');

  const configKeys = CONFIG_KEYS.join(' ');
  const shells = SHELL_NAMES.join(' ');
  const hooks = HOOK_NAMES.join(' ');

  return `__gji_worktree_branches() {
  command gji ls 2>/dev/null | awk 'NR > 1 && $2 != "(detached)" { print $2 }'
}

_gji_completion() {
  local context state line
  local -a commands worktree_branches

  commands=(
    ${commandLines}
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case "\${words[2]}" in
    new)
      _arguments '--detached[create a detached worktree without a branch]' '--dry-run[show what would be created without executing any git commands or writing files]' '--json[emit JSON on success or error instead of human-readable output]' '2:branch: '
      ;;
    init)
      _arguments '--write[write the integration to the shell config file]' '2:shell:(${shells})'
      ;;
    completion)
      _arguments '2:shell:(${shells})'
      ;;
    pr)
      _arguments '--dry-run[show what would be created without executing any git commands or writing files]' '--json[emit JSON on success or error instead of human-readable output]' '2:ref: '
      ;;
    go)
      _arguments '--print[print the resolved worktree path explicitly]' '2:branch:->worktrees'
      ;;
    root)
      _arguments '--print[print the resolved repository root path explicitly]'
      ;;
    status)
      _arguments '--json[print repository and worktree health as JSON]'
      ;;
    sync)
      _arguments '--all[sync every worktree in the repository]' '--json[emit JSON on success or error instead of human-readable output]'
      ;;
    ls)
      _arguments '--json[print active worktrees as JSON]'
      ;;
    clean)
      _arguments '(-f --force)'{-f,--force}'[bypass prompts, force-remove dirty worktrees, and force-delete unmerged branches]' '--dry-run[show what would be deleted without removing anything]' '--json[emit JSON on success or error instead of human-readable output]'
      ;;
    remove|rm)
      _arguments '(-f --force)'{-f,--force}'[bypass prompts, force-remove a dirty worktree, and force-delete an unmerged branch]' '--dry-run[show what would be deleted without removing anything]' '--json[emit JSON on success or error instead of human-readable output]' '2:branch:->worktrees'
      ;;
    trigger-hook)
      _arguments "2:hook:(${hooks})"
      ;;
    config)
      if (( CURRENT == 3 )); then
        _values 'config action' get set unset
        return
      fi

      case "\${words[3]}" in
        get|unset)
          _arguments '3:key:->config_keys'
          ;;
        set)
          _arguments '3:key:->config_keys' '4:value: '
          ;;
      esac
      ;;
  esac

  case "$state" in
    worktrees)
      worktree_branches=(\${(@f)$(__gji_worktree_branches)})
      _describe 'worktree branch' worktree_branches
      ;;
    config_keys)
      _values 'config key' ${configKeys}
      ;;
  esac
}

compdef _gji_completion gji`;
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, `'\\''`);
}
