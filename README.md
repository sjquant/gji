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

## Planned commands

- `gji new` - create a new branch + linked worktree
- `gji pr <number>` - fetch PR ref and create worktree
- `gji go [branch]` - print/open the worktree path for quick jump; if branch is omitted, open a TUI to select an existing worktree/branch
- `gji root` - print the main repository root path from anywhere (root or worktree)
- `gji ls` - list active worktrees in a readable table
- `gji clean` - interactively select and remove worktrees
- `gji done [branch]` - finish flow: confirm, remove target worktree, delete the branch too, and return to repo root; if branch is omitted, prompt for it
