# TASKS

**## Status**
TODO

## Tasks

- [DONE] Set up the TypeScript CLI project structure, command entrypoint, and shared configuration/loading utilities for `gji`.
- [DONE] Implement repository detection and deterministic worktree path resolution that works from the repo root or any nested worktree path.
- [DONE] Implement `gji new` to create a branch and linked worktree, including interactive handling when the target path already exists.
- [DONE] Implement `gji pr <number>` to fetch GitHub PR refs and create a linked worktree from the fetched ref.
- [DONE] Implement `gji go [branch]` and `gji root`, including interactive branch/worktree selection when no branch is provided.
- [DONE] Implement `gji ls` to display active worktrees in a readable table.
- [REVIEW] Implement `gji clean` and `gji done [branch]` with confirmation prompts and safe deletion of worktrees and branches.
- [TODO] Implement a future `gji config` command to manage global config defaults without requiring repo initialization.
- [TODO] Add optional global and repo-local config layering only when a concrete setting requires it.
- [TODO] Add tests and documentation coverage for core pathing, Git command flows, interactive prompts, and destructive-action safeguards.

## Handoff Notes

- Bootstrap CLI, config-loading, and repository-pathing utilities now exist under `src/`; upcoming work should build on those modules rather than recreating them.
- The highest-risk areas are repository/worktree path detection, PR ref handling, and safe cleanup flows; validate those first when implementation begins.
