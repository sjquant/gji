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

Current source install:

```sh
git clone https://github.com/sjquant/gji.git
cd gji
pnpm install
pnpm build
npm install -g .
```

Confirm the CLI is available:

```sh
gji --version
gji --help
```

## Quick start

Inside a Git repository:

```sh
gji new feature/login-form
gji status
```

That creates a linked worktree at a deterministic path:

```text
../worktrees/<repo>/<branch>
```

## Shell setup

`gji new`, `gji go`, `gji root`, and `gji remove`/`gji rm` can only change your current directory when shell integration is installed. Without shell integration, the raw CLI prints the target path so it stays script-friendly.

For zsh:

```sh
echo 'eval "$(gji init zsh)"' >> ~/.zshrc
source ~/.zshrc
```

After that:

```sh
gji new feature/login-form
gji go feature/login-form
gji root
gji rm feature/login-form
```

changes your shell directory directly.

If you reinstall or upgrade `gji`, refresh the shell function:

```sh
eval "$(gji init zsh)"
```

For scripts or explicit piping:

```sh
gji new feature/login-form
gji go --print feature/login-form
gji root --print
```

`gji new` and `gji remove` print their destination paths in raw CLI mode, but in a shell-integrated session they change directory directly.

## Daily workflow

Start a task:

```sh
gji new feature/refactor-auth
```

Start a detached scratch worktree:

```sh
gji new --detached
```

Check what is active:

```sh
gji status
gji ls
```

Pull a PR into its own worktree:

```sh
gji pr 123
gji pr #123
gji pr https://github.com/owner/repo/pull/123
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
# or
gji rm feature/refactor-auth
```

After removal, the shell-integrated command returns you to the repository root.

## Commands

- `gji --version` prints the installed CLI version
- `gji init [shell]` prints shell integration for `zsh`, `bash`, or `fish`
- `gji new [branch] [--detached]` creates a branch and linked worktree; with shell integration it moves into the new worktree, and `--detached` creates a detached worktree instead
- `gji pr <ref>` accepts `123`, `#123`, or a full PR/MR URL, extracts the numeric ID, then fetches `origin/pull/<number>/head` and creates a linked `pr/<number>` worktree
- `gji go [branch] [--print]` jumps to an existing worktree when shell integration is installed, or prints the matching worktree path otherwise
- `gji root [--print]` jumps to the main repository root when shell integration is installed, or prints it otherwise
- `gji status [--json]` prints repository metadata, worktree health, and upstream divergence
- `gji sync [--all]` fetches from the configured remote and rebases or fast-forwards worktrees onto the configured default branch
- `gji ls [--json]` lists active worktrees in a table or JSON
- `gji clean` interactively prunes one or more linked worktrees, including detached entries, while excluding the current worktree
- `gji remove [branch]` and `gji rm [branch]` remove a linked worktree and delete its branch when present; with shell integration they return to the repository root
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
- `hooks`

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

## Hooks

`hooks` runs shell commands at key points in the worktree lifecycle. Configure it in `.gji.json` or `~/.config/gji/config.json`:

```json
{
  "hooks": {
    "afterCreate": "pnpm install",
    "afterEnter": "echo switched to {{branch}}",
    "beforeRemove": "pnpm run cleanup"
  }
}
```

Hook keys:

- `afterCreate` — runs after a new worktree is created, whether via `gji new` or `gji pr`
- `afterEnter` — runs after switching to a worktree via `gji go`
- `beforeRemove` — runs before a worktree is removed via `gji remove`

Each hook receives context in two ways:

**Template variables** (substituted into the command string):

| Variable | Value |
|---|---|
| `{{branch}}` | branch name, or empty string for detached worktrees |
| `{{path}}` | absolute path to the worktree |
| `{{repo}}` | repository directory name |

**Environment variables** (available to the hook process):

| Variable | Value |
|---|---|
| `GJI_BRANCH` | branch name, or empty string for detached worktrees |
| `GJI_PATH` | absolute path to the worktree |
| `GJI_REPO` | repository directory name |

Hooks run inside the worktree directory. A non-zero exit emits a warning but does not abort the command.

Global and project-level hooks are merged per key — project values override global values for the same key, while keys only present in the global config still apply:

```json
// ~/.config/gji/config.json
{ "hooks": { "afterCreate": "nvm use", "afterEnter": "echo hi" } }

// .gji.json
{ "hooks": { "afterCreate": "pnpm install" } }

// effective hooks
{ "afterCreate": "pnpm install", "afterEnter": "echo hi" }
```

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
- `gji pr` accepts GitHub, GitLab, and Bitbucket-style PR/MR links, but still fetches from `origin` using GitHub-style `refs/pull/<number>/head`

## License

MIT
