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
- R3. The CLI must work without a required project bootstrap or initialization step.
- R4. The CLI should support optional configuration layering through built-in defaults plus global and repo-local config when concrete settings need to be overridden.
- R5. The CLI must support creating a new branch and linked worktree through `gji new`.
- R6. The CLI must support fetching a GitHub pull request ref and creating a worktree from it through `gji pr <number>`.
- R7. The CLI must support jumping to an existing worktree path through `gji go [branch]`, with interactive selection when no branch is provided.
- R8. The CLI must print the main repository root path through `gji root`.
- R9. The CLI must list active worktrees in a readable table through `gji ls`.
- R10. The CLI must support interactive cleanup of stale, merged, unwanted, or detached worktrees through `gji remove [branch]`.
- R11. The CLI must support a completion flow through `gji remove [branch]` that confirms removal, deletes the target worktree, deletes the branch when one exists, and returns the user to the repository root.
- R12. The CLI must handle path conflicts interactively when a target worktree directory already exists.
- R13. The CLI should support a `gji config` command for managing global configuration defaults without requiring per-repository initialization.

## In Scope
- A local TypeScript command-line tool for Git worktree lifecycle management.
- Branch-based and PR-based worktree creation flows.
- Interactive prompts for selection, conflict resolution, and cleanup.
- Repository-aware path resolution and worktree discovery.
- Optional global and repo-local configuration overrides.
- A future `gji config` command for managing global defaults when configuration becomes necessary.
- Shell-friendly command behavior that composes cleanly with standard terminal tooling.

## Out of Scope
- GUI or web interface.
- Remote repository hosting beyond Git and GitHub PR ref usage described in the README.
- A required per-repository bootstrap or initialization command before normal usage.
- Built-in editor, agent, or arbitrary command launching after worktree setup; users can compose `gji` with shell commands instead.
- Full project or dependency environment provisioning beyond worktree setup itself.
- Non-interactive bulk orchestration across many repositories.

## Constraints
- The implementation must work within Git worktree semantics and local filesystem constraints.
- The workflow should remain fast and opinionated rather than exposing every possible Git option.
- The default workflow should be usable immediately without mandatory setup.
- Shell composition should rely on standard terminal features rather than built-in post-setup exec hooks.
- Interactive flows must be safe for destructive actions such as cleanup and branch deletion.
- The initial scope should align with the commands and behaviors already described in `README.md`.
