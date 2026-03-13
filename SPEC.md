# SPEC

## Goal
- Build `gji`, a TypeScript CLI that makes Git context switching fast by creating and managing isolated worktrees for branches and pull requests.

## Context
- The project is under active development and currently documents the intended workflow in `README.md`.
- The primary pain points are dirty working trees, repeated stash/pop cycles, dependency reinstall churn, and weak cleanup of stale worktrees.
- The CLI is intended to support concurrent work across multiple isolated worktrees, including AI-assisted development workflows.

## Why
- Standard branch switching becomes costly when developers frequently move between tasks, branches, and pull requests.
- Dedicated worktrees reduce context-switching overhead and make parallel task execution more predictable.
- A deterministic worktree workflow improves discoverability, cleanup, and automation opportunities.

## Requirements
- R1. The CLI must detect the main repository root from either the repo root or a nested worktree path.
- R2. The CLI must use a deterministic workspace layout at `../worktrees/{repo}/{branch}`.
- R3. The CLI must support initializing project configuration through `gji init`.
- R4. The CLI must support creating a new branch and linked worktree through `gji new`.
- R5. The CLI must support fetching a GitHub pull request ref and creating a worktree from it through `gji pr <number>`.
- R6. The CLI must support jumping to an existing worktree path through `gji go [branch]`, with interactive selection when no branch is provided.
- R7. The CLI must print the main repository root path through `gji root`.
- R8. The CLI must list active worktrees in a readable table through `gji ls`.
- R9. The CLI must support interactive cleanup of stale, merged, or unwanted worktrees through `gji clean`.
- R10. The CLI must support a completion flow through `gji done [branch]` that confirms removal, deletes the target worktree, deletes the branch, and returns the user to the repository root.
- R11. The CLI must handle path conflicts interactively when a target worktree directory already exists.

## In Scope
- A local TypeScript command-line tool for Git worktree lifecycle management.
- Branch-based and PR-based worktree creation flows.
- Interactive prompts for selection, conflict resolution, and cleanup.
- Repository-aware path resolution and worktree discovery.
- Shell-friendly command behavior that composes cleanly with standard terminal tooling.

## Out of Scope
- GUI or web interface.
- Remote repository hosting beyond Git and GitHub PR ref usage described in the README.
- Built-in editor, agent, or arbitrary command launching after worktree setup; users can compose `gji` with shell commands instead.
- Full project or dependency environment provisioning beyond worktree setup itself.
- Non-interactive bulk orchestration across many repositories.

## Constraints
- The implementation must work within Git worktree semantics and local filesystem constraints.
- The workflow should remain fast and opinionated rather than exposing every possible Git option.
- Shell composition should rely on standard terminal features rather than built-in post-setup exec hooks.
- Interactive flows must be safe for destructive actions such as cleanup and branch deletion.
- The initial scope should align with the commands and behaviors already described in `README.md`.
