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
- PR-to-tree flow using GitHub PR refs (e.g. `origin/pull/123/head`)
- Interactive conflict handling when target paths already exist
- Interactive cleanup for stale or merged worktrees
- Shell-friendly output that composes with standard terminal tooling

## Commands

- `gji new <branch>` - create a new branch and linked worktree, using `branchPrefix` from config when set
- `gji pr <number>` - fetch `origin/pull/<number>/head` and create a linked `pr/<number>` worktree
- `gji go [branch]` - print the matching worktree path, or choose one interactively when no branch is provided
- `gji root` - print the main repository root path from either the repo root or a linked worktree
- `gji ls` - list the active worktrees in a branch/path table
- `gji clean` - interactively select linked worktrees to remove, with confirmation before deletion
- `gji done [branch]` - remove a linked worktree, delete its branch, and print the repo root after confirmation
- `gji config` - inspect or manage global defaults with `get`, `set`, and `unset`

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
