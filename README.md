# gji

Context switching without the mess.

`gji` is a Git worktree CLI for people who jump between tasks all day. It gives each branch or PR its own directory, so you stop doing `stash`, `pop`, reinstall cycles, and fragile branch juggling.

## Why

Standard branch switching gets annoying when you are:

- fixing one bug while reviewing another branch
- hopping between feature work and PR checks
- using multiple terminals, editors, or AI agents at the same time

`gji` keeps those contexts isolated in separate worktrees with deterministic paths.

## Install

Install from npm:

```sh
npm install -g @solaqua/gji
```

Confirm the CLI is available:

```sh
gji --help
```

The installed command is still:

```sh
gji
```

## Quick start

Inside a Git repository:

```sh
gji new feature/login-form
gji go feature/login-form
gji status
```

That creates a linked worktree at a deterministic path:

```text
../worktrees/<repo>/<branch>
```

## Shell setup

`gji go` can only change your current directory when shell integration is installed. Without shell integration, the raw CLI prints the target path so it stays script-friendly.

For zsh:

```sh
echo 'eval "$(gji init zsh)"' >> ~/.zshrc
source ~/.zshrc
```

After that:

```sh
gji go feature/login-form
```

changes your shell directory directly.

For scripts or explicit piping:

```sh
gji go --print feature/login-form
```

## Daily workflow

Start a task:

```sh
gji new feature/refactor-auth
gji go feature/refactor-auth
```

Check what is active:

```sh
gji status
gji ls
```

Pull a PR into its own worktree:

```sh
gji pr 123
```

Sync the current worktree with the latest default branch:

```sh
gji sync
```

Sync every worktree in the repository:

```sh
gji sync --all
```

Clean up stale linked worktrees interactively:

```sh
gji clean
```

Finish a single worktree explicitly:

```sh
gji remove feature/refactor-auth
```

## Commands

- `gji init [shell]` prints shell integration for `zsh`, `bash`, or `fish`
- `gji new [branch]` creates a branch and linked worktree; when omitted, it prompts with a placeholder branch name
- `gji pr <number>` fetches `origin/pull/<number>/head` and creates a linked `pr/<number>` worktree
- `gji go [branch]` jumps to an existing worktree when shell integration is installed, or prints the matching worktree path otherwise
- `gji root` prints the main repository root path from either the repo root or a linked worktree
- `gji status [--json]` prints repository metadata, worktree health, and upstream divergence
- `gji sync [--all]` fetches from the configured remote and rebases or fast-forwards worktrees onto the configured default branch
- `gji ls [--json]` lists active worktrees in a table or JSON
- `gji clean` interactively prunes one or more linked worktrees, including detached entries, while excluding the current worktree
- `gji remove [branch]` removes a linked worktree and deletes its branch when present
- `gji config` reads or updates global defaults

## Configuration

`gji` is usable without setup, but it supports defaults through:

- global config at `~/.config/gji/config.json`
- repo-local config at `.gji.json`

Repo-local values override global defaults.

Supported keys:

- `branchPrefix`
- `syncRemote`
- `syncDefaultBranch`

Example:

```json
{
  "branchPrefix": "feature/",
  "syncRemote": "upstream",
  "syncDefaultBranch": "main"
}
```

Behavior:

- if `syncRemote` is unset, `gji sync` defaults to `origin`
- if `syncDefaultBranch` is unset, `gji sync` resolves the remote default branch from `HEAD`

## JSON output

`gji ls --json` returns branch/path entries:

```sh
gji ls --json
```

`gji status --json` returns a top-level object with:

- `repoRoot`
- `currentRoot`
- `worktrees`

Each worktree entry contains:

- `branch`: branch name or `null` for detached worktrees
- `current`
- `path`
- `status`: `clean` or `dirty`
- `upstream`: one of
  - `{ "kind": "detached" }`
  - `{ "kind": "no-upstream" }`
  - `{ "kind": "tracked", "ahead": number, "behind": number }`

## Notes

- `gji` works from either the main repository root or any linked worktree
- the current worktree is never offered as a `gji clean` removal candidate
- `gji` currently uses GitHub-style PR refs for `gji pr`

## License

MIT
