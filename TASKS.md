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
- [DONE] Add `gji init [shell] [--write]` shell integration so `gji go [branch]` can change the current shell directory directly, while preserving the current raw CLI path-printing behavior for backward compatibility and a script-friendly mode such as `gji go --print`.
- [DONE] Implement `gji status` to summarize worktree health, including branch state and useful at-a-glance repository metadata.
- [DONE] Implement `gji sync [--all]` to fetch/prune remotes and update one or all worktrees against the configured default branch safely.
- [DONE] Add structured machine-readable output for `gji ls --json`.
- [DONE] Update `README.md` to document `gji init`, shell integration setup, `gji status`, `gji sync`, and `gji ls --json` with realistic examples.
- [DONE] Add configurable sync defaults for remote and default-branch resolution instead of assuming `origin` and remote `HEAD`.
- [DONE] Expand `gji status` to show upstream divergence signals such as ahead/behind counts for branch-backed worktrees.
- [REVIEW] Add `gji status --json` with stable machine-readable output for repository metadata, worktree health, and upstream divergence.
- [REVIEW] Implement `gji clean` to prune stale linked worktrees safely, with detached-worktree handling and clear confirmation prompts.
- [REVIEW] Expand README and SPEC to document `syncRemote` and `syncDefaultBranch` configuration, plus the new `gji status --json` contract.

## Handoff Notes

- Bootstrap CLI, config-loading, and repository-pathing utilities now exist under `src/`; upcoming work should build on those modules rather than recreating them.
- The highest-risk areas are repository/worktree path detection, PR ref handling, and safe cleanup flows; validate those first when implementation begins.
- `gji go` cannot change the caller's directory as a plain child process; that feature needs shell integration (for example a sourced shell function installed via `gji init`) rather than only more Commander logic.
- Keep the raw binary behavior for `gji go` backward-compatible: without shell integration it should continue printing the path, while `gji go --print` remains the explicit stable scripting mode.
