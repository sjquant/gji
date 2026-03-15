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
- [DONE] Implement `gji remove [branch]` with confirmation prompts and safe deletion of worktrees and branches.
- [DONE] Implement a future `gji config` command to manage global config defaults without requiring repo initialization.
- [DONE] Add optional global and repo-local config layering only when a concrete setting requires it.
- [DONE] Add tests and documentation coverage for core pathing, Git command flows, interactive prompts, and destructive-action safeguards.
- [TODO] Add `gji init [shell] [--write]` shell integration so `gji go [branch]` can change the current shell directory directly, while preserving a script-friendly path-printing mode such as `gji go --print`.
- [TODO] Implement `gji status` to summarize worktree health, including branch state and useful at-a-glance repository metadata.
- [TODO] Implement `gji sync [--all]` to fetch/prune remotes and update one or all worktrees against the configured default branch safely.
- [TODO] Add structured machine-readable output for `gji ls --json`.

## Handoff Notes

- Bootstrap CLI, config-loading, and repository-pathing utilities now exist under `src/`; upcoming work should build on those modules rather than recreating them.
- The highest-risk areas are repository/worktree path detection, PR ref handling, and safe cleanup flows; validate those first when implementation begins.
- `gji go` cannot change the caller's directory as a plain child process; that feature needs shell integration (for example a sourced shell function installed via `gji init`) rather than only more Commander logic.
