import { KNOWN_GLOBAL_CONFIG_KEYS } from "./config.js";

const TOP_LEVEL_COMMANDS = [
	{
		name: "new",
		description: "create a new branch or detached linked worktree",
	},
	{
		name: "init",
		description:
			"set up shell integration interactively or print a shell wrapper",
	},
	{
		name: "doctor",
		description: "check gji installation and configuration health",
	},
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
		name: "run-hook",
		description: "run a named hook in the current worktree",
	},
	{ name: "warp", description: "jump to any worktree across all known repos" },
	{ name: "config", description: "manage global config defaults" },
] as const;

const SHELL_NAMES = ["bash", "fish", "zsh"] as const;
const HOOK_NAMES = ["after-create", "after-enter", "before-remove"] as const;
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

__gji_pr_targets_cache=""
__gji_pr_targets_cache_at=0
__gji_pr_targets_cache_loaded=0
__gji_pr_targets_cache_repo=""

__gji_run_bounded() {
  local output_file pid status attempt
  output_file=$(mktemp "\${TMPDIR:-/tmp}/gji-completion.XXXXXX") || return 124
  "$@" >"$output_file" 2>/dev/null &
  pid=$!
  for ((attempt = 0; attempt < 20; attempt++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
      status=$?
      cat "$output_file"
      rm -f "$output_file"
      return "$status"
    fi
    sleep 0.1
  done
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  rm -f "$output_file"
  return 124
}

__gji_pr_targets() {
  local now repo_key branches targets
  now=$(date +%s)
  repo_key=$(command git rev-parse --show-toplevel 2>/dev/null)
  if [ "$__gji_pr_targets_cache_loaded" -eq 1 ] && [ "$repo_key" = "$__gji_pr_targets_cache_repo" ] && [ "$((now - __gji_pr_targets_cache_at))" -lt 30 ]; then
    printf '%s\n' "$__gji_pr_targets_cache"
    return
  fi

  branches="$(__gji_worktree_branches)"
  targets=""
  if [ -n "$repo_key" ] && command -v gh >/dev/null 2>&1; then
    targets=$(__gji_run_bounded env GH_PROMPT_DISABLED=1 gh pr list --state open --json number --limit 100 |
      tr '{},' '\\n' | sed -n 's/.*"number":[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p')
  elif [ -n "$repo_key" ] && command -v glab >/dev/null 2>&1; then
    targets=$(__gji_run_bounded env GLAB_NON_INTERACTIVE=1 glab mr list --state opened --output json --per-page 100 |
      tr '{},' '\\n' | sed -n 's/.*"iid":[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p')
  elif [ -n "$repo_key" ] && command -v bb >/dev/null 2>&1; then
    targets=$(__gji_run_bounded bb pr list --state OPEN --format json |
      tr '{},' '\\n' | sed -n 's/.*"id":[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p')
  fi

  __gji_pr_targets_cache="$branches"
  if [ -n "$targets" ]; then
    if [ -n "$__gji_pr_targets_cache" ]; then
      __gji_pr_targets_cache+=$'\n'
    fi
    __gji_pr_targets_cache+="$targets"
  fi
  __gji_pr_targets_cache_at="$now"
  __gji_pr_targets_cache_loaded=1
  __gji_pr_targets_cache_repo="$repo_key"
  printf '%s\n' "$__gji_pr_targets_cache"
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
      COMPREPLY=( $(compgen -W "${shells} --write --json --help" -- "$cur") )
      ;;
    doctor)
      COMPREPLY=( $(compgen -W "--fix --yes --json --help" -- "$cur") )
      ;;
    completion)
      COMPREPLY=( $(compgen -W "${shells} --help" -- "$cur") )
      ;;
    pr)
      if [ "$COMP_CWORD" -eq 2 ]; then
        COMPREPLY=( $(compgen -W "open --dry-run --json --help" -- "$cur") )
      elif [ "\${COMP_WORDS[2]}" = "open" ]; then
        local has_select=0 has_target=0 word
        for word in "\${COMP_WORDS[@]:3:$((COMP_CWORD - 3))}"; do
          if [ "$word" = "--select" ]; then has_select=1; fi
          if [[ "$word" != -* && "$word" != "" ]]; then has_target=1; fi
        done
        if [[ "$cur" == -* ]]; then
          if [[ "$has_select" -eq 1 || "$has_target" -eq 1 ]]; then
            COMPREPLY=( $(compgen -W "--help" -- "$cur") )
          else
            COMPREPLY=( $(compgen -W "--select --help" -- "$cur") )
          fi
        elif [[ "$has_select" -eq 1 || "$has_target" -eq 1 ]]; then
          COMPREPLY=()
        else
          COMPREPLY=( $(compgen -W "$(__gji_pr_targets) --select --help" -- "$cur") )
        fi
      else
        COMPREPLY=( $(compgen -W "--dry-run --json --help" -- "$cur") )
      fi
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
    run-hook)
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
			`complete -c gji -n '__fish_seen_subcommand_from run-hook' -a '${hook}' -d 'hook'`,
	).join("\n");

	const configKeyLines = CONFIG_KEYS.map(
		(key) =>
			`complete -c gji -n '__gji_should_complete_config_key' -a '${key}' -d 'config key'`,
	).join("\n");

	return `function __gji_worktree_branches
    command gji ls --compact 2>/dev/null | awk 'NR > 1 { branch = ($1 == "*" ? $2 : $1); if (branch != "(detached)") print branch }'
end

set -g __gji_pr_targets_cache
set -g __gji_pr_targets_cache_at 0
set -g __gji_pr_targets_cache_loaded 0
set -g __gji_pr_targets_cache_repo

function __gji_run_bounded
    set -l output_file (mktemp "$TMPDIR/gji-completion.XXXXXX" 2>/dev/null)
    if test -z "$output_file"
        set output_file (mktemp "/tmp/gji-completion.XXXXXX" 2>/dev/null)
    end
    if test -z "$output_file"
        return 124
    end

    command $argv >$output_file 2>/dev/null &
    set -l pid $last_pid
    for attempt in (seq 1 20)
        if not kill -0 $pid 2>/dev/null
            wait $pid
            set -l exit_status $status
            command cat $output_file
            command rm -f $output_file
            return $exit_status
        end
        sleep 0.1
    end
    kill $pid 2>/dev/null
    wait $pid 2>/dev/null
    command rm -f $output_file
    return 124
end

function __gji_pr_targets
    set -l now (date +%s)
    set -l repo_key (command git rev-parse --show-toplevel 2>/dev/null)
    if test $__gji_pr_targets_cache_loaded -eq 1; and test "$repo_key" = "$__gji_pr_targets_cache_repo"; and test (math $now - $__gji_pr_targets_cache_at) -lt 30
        printf '%s\n' $__gji_pr_targets_cache
        return
    end

    set -l branches (__gji_worktree_branches)
    set -l targets
    if test -n "$repo_key"; and command -q gh
        set targets (__gji_run_bounded env GH_PROMPT_DISABLED=1 gh pr list --state open --json number --limit 100 |
            string replace -a -r '[{},]' '\\n' |
            string match -r '"number"[[:space:]]*:[[:space:]]*[0-9]+' | string replace -r '.*:[[:space:]]*' '')
    else if test -n "$repo_key"; and command -q glab
        set targets (__gji_run_bounded env GLAB_NON_INTERACTIVE=1 glab mr list --state opened --output json --per-page 100 |
            string replace -a -r '[{},]' '\\n' |
            string match -r '"iid"[[:space:]]*:[[:space:]]*[0-9]+' | string replace -r '.*:[[:space:]]*' '')
    else if test -n "$repo_key"; and command -q bb
        set targets (__gji_run_bounded bb pr list --state OPEN --format json |
            string replace -a -r '[{},]' '\\n' |
            string match -r '"id"[[:space:]]*:[[:space:]]*[0-9]+' | string replace -r '.*:[[:space:]]*' '')
    end

    set -g __gji_pr_targets_cache $branches $targets
    set -g __gji_pr_targets_cache_at $now
    set -g __gji_pr_targets_cache_loaded 1
    set -g __gji_pr_targets_cache_repo $repo_key
    printf '%s\n' $__gji_pr_targets_cache
end

function __gji_should_complete_pr_select
    set -l tokens (commandline -opc)
    if test (count $tokens) -lt 3; or test $tokens[2] != pr; or test $tokens[3] != open
        return 1
    end
    for token in $tokens[4..-1]
        if test $token = --select; or not string match -q -- '-*' $token
            return 1
        end
    end
    return 0
end

function __gji_should_complete_pr_target
    set -l tokens (commandline -opc)
    if test (count $tokens) -lt 3; or test $tokens[2] != pr; or test $tokens[3] != open
        return 1
    end
    if string match -q -- '-*' (commandline -ct)
        return 1
    end
    for token in $tokens[4..-1]
        if test $token = --select
            return 1
        end
        if not string match -q -- '-*' $token
            return 1
        end
    end
    return 0
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
complete -c gji -n '__fish_seen_subcommand_from init' -l json -d 'emit a JSON error in non-interactive mode'
${shellLines}

complete -c gji -n '__fish_seen_subcommand_from doctor' -l fix -d 'apply safe automatic fixes after showing the plan'
complete -c gji -n '__fish_seen_subcommand_from doctor' -l yes -d 'apply --fix without prompting'
complete -c gji -n '__fish_seen_subcommand_from doctor' -l json -d 'emit diagnostic checks as JSON'

complete -c gji -n '__fish_seen_subcommand_from completion' -a 'bash' -d 'shell'
complete -c gji -n '__fish_seen_subcommand_from completion' -a 'fish' -d 'shell'
complete -c gji -n '__fish_seen_subcommand_from completion' -a 'zsh' -d 'shell'

complete -c gji -n '__fish_seen_subcommand_from pr; and test (commandline -opc)[3] != open' -l dry-run -d 'show what would be created without executing any git commands or writing files'
complete -c gji -n '__fish_seen_subcommand_from pr; and test (commandline -opc)[3] != open' -l json -d 'emit JSON on success or error instead of human-readable output'
complete -c gji -n '__fish_seen_subcommand_from pr' -a 'open' -d 'open a pull request in the default browser'
complete -c gji -n '__gji_should_complete_pr_select' -l select -d 'choose a pull request from any linked worktree'
complete -c gji -n '__gji_should_complete_pr_target' -a '(__gji_pr_targets)' -d 'branch or PR number'

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

typeset -g __gji_pr_targets_cache=()
typeset -g __gji_pr_targets_cache_at=0
typeset -g __gji_pr_targets_cache_loaded=0
typeset -g __gji_pr_targets_cache_repo=""

__gji_run_bounded() {
  local output_file pid status attempt
  output_file=$(mktemp "\${TMPDIR:-/tmp}/gji-completion.XXXXXX") || return 124
  "$@" >"$output_file" 2>/dev/null &
  pid=$!
  for ((attempt = 0; attempt < 20; attempt++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
      status=$?
      cat "$output_file"
      rm -f "$output_file"
      return "$status"
    fi
    sleep 0.1
  done
  kill "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  rm -f "$output_file"
  return 124
}

__gji_pr_targets() {
  local now repo_key
  local -a branches targets
  now=$(date +%s)
  repo_key=$(command git rev-parse --show-toplevel 2>/dev/null)
  if (( __gji_pr_targets_cache_loaded == 1 && "\${repo_key}" == "\${__gji_pr_targets_cache_repo}" && now - __gji_pr_targets_cache_at < 30 )); then
    print -rl -- "\${__gji_pr_targets_cache[@]}"
    return
  fi

  branches=("\${(@f)$(__gji_worktree_branches)}")
  targets=()
  if [[ -n "\${repo_key}" && $+commands[gh] -eq 1 ]]; then
    targets=("\${(@f)$(__gji_run_bounded env GH_PROMPT_DISABLED=1 gh pr list --state open --json number --limit 100 |
      tr '{},' '\\n' | sed -n 's/.*"number":[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p')}")
  elif [[ -n "\${repo_key}" && $+commands[glab] -eq 1 ]]; then
    targets=("\${(@f)$(__gji_run_bounded env GLAB_NON_INTERACTIVE=1 glab mr list --state opened --output json --per-page 100 |
      tr '{},' '\\n' | sed -n 's/.*"iid":[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p')}")
  elif [[ -n "\${repo_key}" && $+commands[bb] -eq 1 ]]; then
    targets=("\${(@f)$(__gji_run_bounded bb pr list --state OPEN --format json |
      tr '{},' '\\n' | sed -n 's/.*"id":[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p')}")
  fi

  __gji_pr_targets_cache=("\${branches[@]}" "\${targets[@]}")
  __gji_pr_targets_cache_at="$now"
  __gji_pr_targets_cache_loaded=1
  __gji_pr_targets_cache_repo="$repo_key"
  print -rl -- "\${__gji_pr_targets_cache[@]}"
}

local context state line
local -a command_entries worktree_branches

command_entries=(
  ${commandLines}
)

if (( CURRENT == 2 )); then
  _describe 'command' command_entries
  return
fi

case "\${words[2]}" in
  new)
    _arguments '--detached[create a detached worktree without a branch]' '--force[remove and recreate the worktree if the target path already exists]' '--open[open the new worktree in an editor after creation]' '--editor[editor CLI to use with --open (code, cursor, zed, …)]:editor:' '--dry-run[show what would be created without executing any git commands or writing files]' '--json[emit JSON on success or error instead of human-readable output]' '2:branch: '
    ;;
  init)
    _arguments '--write[write the integration to the shell config file]' '--json[emit a JSON error in non-interactive mode]' '2:shell:(${shells})'
    ;;
  doctor)
    _arguments '--fix[apply safe automatic fixes after showing the plan]' '--yes[apply --fix without prompting]' '--json[emit diagnostic checks as JSON]'
    ;;
  completion)
    _arguments '2:shell:(${shells})'
    ;;
  pr)
    if [[ "\${words[3]}" == "open" ]]; then
      if (( \${words[(I)--select]} )); then
        _arguments
      elif [[ -n "\${words[4]}" && "\${words[4]}" != -* ]]; then
        _arguments
      else
        _arguments '--select[choose a pull request from any linked worktree]' '4:branch or PR number:->pr_targets'
      fi
    else
      _arguments '--dry-run[show what would be created without executing any git commands or writing files]' '--json[emit JSON on success or error instead of human-readable output]' '2:ref:(open)'
    fi
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
  run-hook)
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
  pr_targets)
    worktree_branches=(\${(@f)$(__gji_pr_targets)})
    _describe 'branch or PR number' worktree_branches
    ;;
  config_keys)
    _values 'config key' ${configKeys}
    ;;
esac`;
}

function escapeSingleQuotes(value: string): string {
	return value.replace(/'/g, `'\\''`);
}
