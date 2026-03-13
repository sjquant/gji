# TASKS

**## Status**
TODO

## Tasks

- [DONE] Set up the TypeScript CLI project structure, command entrypoint, and shared configuration/loading utilities for `gji`.
- [TODO] Implement repository detection and deterministic worktree path resolution that works from the repo root or any nested worktree path.
- [TODO] Implement `gji init` to initialize project config.
- [TODO] Implement `gji new` to create a branch and linked worktree, including interactive handling when the target path already exists.
- [TODO] Implement `gji pr <number>` to fetch GitHub PR refs and create a linked worktree from the fetched ref.
- [TODO] Implement `gji go [branch]` and `gji root`, including interactive branch/worktree selection when no branch is provided.
- [TODO] Implement `gji ls` to display active worktrees in a readable table.
- [TODO] Implement `gji clean` and `gji done [branch]` with confirmation prompts and safe deletion of worktrees and branches.
- [TODO] Add tests and documentation coverage for core pathing, Git command flows, interactive prompts, and destructive-action safeguards.

## Handoff Notes

- Source material for this draft came from `README.md`; no additional implementation files exist yet in the repository.
- The highest-risk areas are repository/worktree path detection, PR ref handling, and safe cleanup flows; validate those first when implementation begins.
