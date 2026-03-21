# gji

Context switching without the mess.

> Status: Under active development.

`gji` (Git Jump Interface) is a TypeScript CLI for managing Git worktrees with a fast, opinionated workflow. It helps you jump between branches and PRs without repeated `stash`, `pop`, and reinstall churn, and fits well with concurrent AI-assisted coding ("vibe coding") across multiple isolated worktrees.

## Why gji

When you switch context often, standard branch workflows create friction:

- dirty working trees
- repetitive stash/pop cycles
- dependency reinstall overhead
- unclear cleanup of old worktrees

`gji` solves this by isolating each task in dedicated worktree directories.

## Core ideas

- Smart pathing from anywhere in a repo (root or nested worktree)
- Deterministic workspace layout: `../worktrees/{repo}/{branch}`
- Zero-config by default, with optional global or repo-local config overrides when needed
- Optional shell integration so `gji go` can change your current shell directory directly
- PR-to-tree flow using GitHub PR refs (e.g. `origin/pull/123/head`)
- Interactive conflict handling when target paths already exist
- Interactive worktree cleanup, including detached worktrees
- Shell-friendly output that composes with standard terminal tooling, including JSON output for `gji ls`

## Commands

- `gji init [shell]` - print shell integration for `zsh`, `bash`, or `fish`
- `gji new <branch>` - create a new branch and linked worktree, using `branchPrefix` from config when set
- `gji pr <number>` - fetch `origin/pull/<number>/head` and create a linked `pr/<number>` worktree
- `gji go [branch]` - jump to an existing worktree when shell integration is installed, or print the matching worktree path otherwise
- `gji root` - print the main repository root path from either the repo root or a linked worktree
- `gji status` - summarize repository metadata, clean/dirty state, and upstream divergence per worktree
- `gji sync [--all]` - fetch from `origin` and update the current or all worktrees onto the remote default branch
- `gji ls [--json]` - list the active worktrees in a branch/path table or structured JSON
- `gji remove [branch]` - remove a linked worktree, delete its branch when present, and print the repo root after confirmation
- `gji config` - inspect or manage global defaults with `get`, `set`, and `unset`

## Shell setup

`gji go` can only change your current directory when shell integration is installed. Without shell integration, the raw CLI keeps printing paths so it remains script-friendly.

For zsh:

```sh
echo 'eval "$(gji init zsh)"' >> ~/.zshrc
source ~/.zshrc
```

After that:

```sh
gji go feature/my-branch
```

will change your current shell directory directly.

If you want the explicit script mode instead, use:

```sh
gji go --print feature/my-branch
```

## Examples

Create a new worktree:

```sh
gji new feature/login-form
```

Fetch a GitHub PR into a dedicated worktree:

```sh
gji pr 123
```

Check repository/worktree health:

```sh
gji status
```

Sync the current worktree onto the latest remote default branch:

```sh
gji sync
```

Sync every worktree in the repository:

```sh
gji sync --all
```

List worktrees as machine-readable JSON:

```sh
gji ls --json
```

## Configuration

`gji` stays zero-config by default. When you need a default, it currently supports `branchPrefix` for `gji new`.

- Global config lives at `~/.config/gji/config.json`
- Repo-local config lives at `.gji.json` in the repository root
- Repo-local values override global defaults

Example global config:

```json
{
  "branchPrefix": "feature/"
}
```
