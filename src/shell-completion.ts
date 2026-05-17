import { KNOWN_GLOBAL_CONFIG_KEYS } from "./config.js";

const TOP_LEVEL_COMMANDS = [
	{
		name: "new",
		description: "create a new branch or detached linked worktree",
	},
	{ name: "init", description: "print or install shell integration" },
	{ name: "completion", description: "print shell completion definitions" },
	{ name: "pr", description: "fetch a pull request into a linked worktree" },
	{ name: "back", description: "navigate to the previously visited worktree" },
	{ name: "history", description: "show navigation history" },
	{ name: "open", description: "open the worktree in an editor" },
	{ name: "go", description: "print or select a worktree path" },
	{ name: "jump", description: "alias of go" },
	{ name: "root", description: "print the main repository root path" },
	{ name: "status", description: "summarize repository and worktree health" },
	{ name: "sync", description: "fetch and update one or all worktrees" },
	{
		name: "sync-files",
		description: "manage local files copied into new worktrees",
	},
	{ name: "ls", description: "list active worktrees" },
	{ name: "clean", description: "interactively prune linked worktrees" },
	{
		name: "remove",
		description: "remove a linked worktree and delete its branch when present",
	},
	{ name: "rm", description: "alias of remove" },
	{
		name: "trigger-hook",
		description: "run a named hook in the current worktree",
	},
	{ name: "warp", description: "jump to any worktree across all known repos" },
	{ name: "config", description: "manage global config defaults" },
] as const;

const SHELL_NAMES = ["bash", "fish", "zsh"] as const;
const HOOK_NAMES = ["afterCreate", "afterEnter", "beforeRemove"] as const;
const CONFIG_KEYS = Array.from(KNOWN_GLOBAL_CONFIG_KEYS);

export function renderShellCompletion(shell: "bash" | "fish" | "zsh"): string {
	switch (shell) {
		case "bash":
			return renderBashCompletion();
		case "fish":
			return renderFishCompletion();
		case "zsh":
			return renderZshCompletion();
	}
}

function renderBashCompletion(): string {
	const topLevelCommands = TOP_LEVEL_COMMANDS.map(
		(command) => command.name,
	).join(" ");
	const shells = SHELL_NAMES.join(" ");
	const hooks = HOOK_NAMES.join(" ");
	const configKeys = CONFIG_KEYS.join(" ");

	return `__gji_worktree_branches() {
  command gji ls --compact 2>/dev/null | awk 'NR > 1 { branch = ($1 == "*" ? $2 : $1); if (branch != "(detached)") print branch }'
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
      COMPREPLY=( $(compgen -W "--detached --force --open --editor --dry-run --json --help" -- "$cur") )
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
    back)
      COMPREPLY=( $(compgen -W "--print --help" -- "$cur") )
      ;;
    history)
      COMPREPLY=( $(compgen -W "--json --help" -- "$cur") )
      ;;
    open)
      COMPREPLY=( $(compgen -W "$(__gji_worktree_branches) --editor --save --workspace --help" -- "$cur") )
      ;;
    go|jump)
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
    sync-files)
      if [ "$COMP_CWORD" -eq 2 ]; then
        COMPREPLY=( $(compgen -W "list add remove rm --json --help" -- "$cur") )
        return 0
      fi
      ;;
    ls)
      COMPREPLY=( $(compgen -W "--compact --json --help" -- "$cur") )
      ;;
    clean)
      COMPREPLY=( $(compgen -W "-f --force --stale --dry-run --json --help" -- "$cur") )
      ;;
    remove|rm)
      COMPREPLY=( $(compgen -W "$(__gji_worktree_branches) -f --force --dry-run --json --help" -- "$cur") )
      ;;
    trigger-hook)
      COMPREPLY=( $(compgen -W "${hooks} --help" -- "$cur") )
      ;;
    warp)
      COMPREPLY=( $(compgen -W "-n --new --print --json --help" -- "$cur") )
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
	const commandLines = TOP_LEVEL_COMMANDS.map(
		(command) =>
			`complete -c gji -n '__fish_use_subcommand' -a '${command.name}' -d '${escapeSingleQuotes(command.description)}'`,
	).join("\n");

	const shellLines = SHELL_NAMES.map(
		(shell) =>
			`complete -c gji -n '__fish_seen_subcommand_from init' -a '${shell}' -d 'shell'`,
	).join("\n");

	const hookLines = HOOK_NAMES.map(
		(hook) =>
			`complete -c gji -n '__fish_seen_subcommand_from trigger-hook' -a '${hook}' -d 'hook'`,
	).join("\n");

	const configKeyLines = CONFIG_KEYS.map(
		(key) =>
			`complete -c gji -n '__gji_should_complete_config_key' -a '${key}' -d 'config key'`,
	).join("\n");

	return `function __gji_worktree_branches
    command gji ls --compact 2>/dev/null | awk 'NR > 1 { branch = ($1 == "*" ? $2 : $1); if (branch != "(detached)") print branch }'
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
complete -c gji -n '__fish_seen_subcommand_from new' -l force -d 'remove and recreate the worktree if the target path already exists'
complete -c gji -n '__fish_seen_subcommand_from new' -l open -d 'open the new worktree in an editor after creation'
complete -c gji -n '__fish_seen_subcommand_from new' -l editor -r -d 'editor CLI to use with --open (code, cursor, zed, …)'
complete -c gji -n '__fish_seen_subcommand_from new' -l dry-run -d 'show what would be created without executing any git commands or writing files'
complete -c gji -n '__fish_seen_subcommand_from new' -l json -d 'emit JSON on success or error instead of human-readable output'

complete -c gji -n '__fish_seen_subcommand_from init' -l write -d 'write the integration to the shell config file'
${shellLines}

complete -c gji -n '__fish_seen_subcommand_from completion' -a 'bash' -d 'shell'
complete -c gji -n '__fish_seen_subcommand_from completion' -a 'fish' -d 'shell'
complete -c gji -n '__fish_seen_subcommand_from completion' -a 'zsh' -d 'shell'

complete -c gji -n '__fish_seen_subcommand_from pr' -l dry-run -d 'show what would be created without executing any git commands or writing files'
complete -c gji -n '__fish_seen_subcommand_from pr' -l json -d 'emit JSON on success or error instead of human-readable output'

complete -c gji -n '__fish_seen_subcommand_from back' -l print -d 'print the resolved worktree path explicitly'

complete -c gji -n '__fish_seen_subcommand_from history' -l json -d 'print history as JSON'

complete -c gji -n '__fish_seen_subcommand_from open' -l editor -r -d 'editor CLI to use (code, cursor, zed, windsurf, subl, …)'
complete -c gji -n '__fish_seen_subcommand_from open' -l save -d 'save the chosen editor to global config'
complete -c gji -n '__fish_seen_subcommand_from open' -l workspace -d 'generate a .code-workspace file before opening (VS Code / Cursor / Windsurf)'
complete -c gji -n '__fish_seen_subcommand_from open' -a '(__gji_worktree_branches)' -d 'worktree branch'

complete -c gji -n '__fish_seen_subcommand_from go jump' -l print -d 'print the resolved worktree path explicitly'
complete -c gji -n '__fish_seen_subcommand_from go jump' -a '(__gji_worktree_branches)' -d 'worktree branch'

complete -c gji -n '__fish_seen_subcommand_from root' -l print -d 'print the resolved repository root path explicitly'

complete -c gji -n '__fish_seen_subcommand_from status' -l json -d 'print repository and worktree health as JSON'

complete -c gji -n '__fish_seen_subcommand_from sync' -l all -d 'sync every worktree in the repository'
complete -c gji -n '__fish_seen_subcommand_from sync' -l json -d 'emit JSON on success or error instead of human-readable output'

complete -c gji -n '__fish_seen_subcommand_from sync-files' -a 'list add remove rm' -d 'sync-files action'
complete -c gji -n '__fish_seen_subcommand_from sync-files' -l json -d 'emit JSON instead of human-readable output'
complete -c gji -n '__fish_seen_subcommand_from list; and __fish_seen_subcommand_from sync-files' -l json -d 'emit JSON instead of human-readable output'
complete -c gji -n '__fish_seen_subcommand_from add; and __fish_seen_subcommand_from sync-files' -l json -d 'emit JSON instead of human-readable output'
complete -c gji -n '__fish_seen_subcommand_from remove rm; and __fish_seen_subcommand_from sync-files' -l json -d 'emit JSON instead of human-readable output'

complete -c gji -n '__fish_seen_subcommand_from ls' -l compact -d 'show only branch and path columns'
complete -c gji -n '__fish_seen_subcommand_from ls' -l json -d 'print active worktrees as JSON'

complete -c gji -n '__fish_seen_subcommand_from clean' -s f -l force -d 'bypass prompts, force-remove dirty worktrees, and force-delete unmerged branches'
complete -c gji -n '__fish_seen_subcommand_from clean' -l stale -d 'only target clean worktrees whose upstream is gone and branch is merged into the default branch'
complete -c gji -n '__fish_seen_subcommand_from clean' -l dry-run -d 'show what would be deleted without removing anything'
complete -c gji -n '__fish_seen_subcommand_from clean' -l json -d 'emit JSON on success or error instead of human-readable output'

complete -c gji -n '__fish_seen_subcommand_from remove rm' -s f -l force -d 'bypass prompts, force-remove a dirty worktree, and force-delete an unmerged branch'
complete -c gji -n '__fish_seen_subcommand_from remove rm' -l dry-run -d 'show what would be deleted without removing anything'
complete -c gji -n '__fish_seen_subcommand_from remove rm' -l json -d 'emit JSON on success or error instead of human-readable output'
complete -c gji -n '__fish_seen_subcommand_from remove rm' -a '(__gji_worktree_branches)' -d 'worktree branch'

${hookLines}

complete -c gji -n '__fish_seen_subcommand_from warp' -s n -l new -d 'create a new worktree in a registered repo'
complete -c gji -n '__fish_seen_subcommand_from warp' -l print -d 'print the resolved worktree path without changing directory'
complete -c gji -n '__fish_seen_subcommand_from warp' -l json -d 'emit JSON on success or error instead of human-readable output'

complete -c gji -n '__fish_seen_subcommand_from config; and __gji_should_complete_config_action' -a 'get set unset' -d 'config action'
${configKeyLines}`;
}

function renderZshCompletion(): string {
	const commandLines = TOP_LEVEL_COMMANDS.map(
		(command) => `'${command.name}:${escapeSingleQuotes(command.description)}'`,
	).join("\n    ");

	const configKeys = CONFIG_KEYS.join(" ");
	const shells = SHELL_NAMES.join(" ");
	const hooks = HOOK_NAMES.join(" ");

	return `#compdef gji

__gji_worktree_branches() {
  command gji ls --compact 2>/dev/null | awk 'NR > 1 { branch = ($1 == "*" ? $2 : $1); if (branch != "(detached)") print branch }'
}

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
    _arguments '--detached[create a detached worktree without a branch]' '--force[remove and recreate the worktree if the target path already exists]' '--open[open the new worktree in an editor after creation]' '--editor[editor CLI to use with --open (code, cursor, zed, …)]:editor:' '--dry-run[show what would be created without executing any git commands or writing files]' '--json[emit JSON on success or error instead of human-readable output]' '2:branch: '
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
  back)
    _arguments '--print[print the resolved worktree path explicitly]' '2:steps: '
    ;;
  history)
    _arguments '--json[print history as JSON]'
    ;;
  open)
    _arguments '--editor[editor CLI to use (code, cursor, zed, windsurf, subl, …)]:editor:' '--save[save the chosen editor to global config]' '--workspace[generate a .code-workspace file before opening (VS Code / Cursor / Windsurf)]' '2:branch:->worktrees'
    ;;
  go|jump)
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
  sync-files)
    _arguments '--json[emit JSON instead of human-readable output]' '2:action:(list add remove rm)' '*:path: '
    ;;
  ls)
    _arguments '--compact[show only branch and path columns]' '--json[print active worktrees as JSON]'
    ;;
  clean)
    _arguments '(-f --force)'{-f,--force}'[bypass prompts, force-remove dirty worktrees, and force-delete unmerged branches]' '--stale[only target clean worktrees whose upstream is gone and branch is merged into the default branch]' '--dry-run[show what would be deleted without removing anything]' '--json[emit JSON on success or error instead of human-readable output]'
    ;;
  remove|rm)
    _arguments '(-f --force)'{-f,--force}'[bypass prompts, force-remove a dirty worktree, and force-delete an unmerged branch]' '--dry-run[show what would be deleted without removing anything]' '--json[emit JSON on success or error instead of human-readable output]' '2:branch:->worktrees'
    ;;
  trigger-hook)
    _arguments "2:hook:(${hooks})"
    ;;
  warp)
    _arguments '(-n --new)'{-n,--new}'[create a new worktree in a registered repo]:branch:' '--print[print the resolved worktree path without changing directory]' '--json[emit JSON on success or error instead of human-readable output]' '2:branch: '
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
esac`;
}

function escapeSingleQuotes(value: string): string {
	return value.replace(/'/g, `'\\''`);
}
