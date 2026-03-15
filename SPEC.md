# SPEC

## Goal
- Build `gji`, a TypeScript CLI that makes Git context switching fast by creating and managing isolated worktrees for branches and pull requests.
- Extend `gji` from basic worktree lifecycle management into a daily-driver workflow tool with shell integration, status visibility, synchronization, and structured output.

## Context
- The project is under active development and currently documents the intended workflow in `README.md`.
- The primary pain points are dirty working trees, repeated stash/pop cycles, dependency reinstall churn, and weak cleanup of stale worktrees.
- The CLI is intended to support concurrent work across multiple isolated worktrees, including AI-assisted development workflows.
- The next stage should reduce friction in the "jump, inspect, sync, and script" loop so developers can keep `gji` open all day rather than treating it as an occasional helper.

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
- R14. The product must support `gji init [shell]` to print shell integration code for supported interactive shells such as zsh, bash, and fish.
- R15. The product should support `gji init [shell] --write` as an explicit opt-in flow to install shell integration into the appropriate shell configuration file when detection is sufficiently reliable.
- R16. The product may auto-detect the user's shell for `gji init` as a convenience, but it must allow an explicit shell argument when detection is ambiguous or incorrect.
- R17. The product must support a shell integration flow so `gji go [branch]` can change the user's current shell directory directly when the integration is installed.
- R18. The CLI must preserve a script-friendly way to print a resolved worktree path for shell composition and automation, for example through `gji go --print`.
- R19. The CLI must support `gji status` to summarize the current repository and linked worktrees with useful health signals such as branch association and repository state.
- R20. The CLI must support `gji sync [--all]` to fetch/prune remotes and update one or all worktrees against the configured default branch safely.
- R21. The CLI must support `gji ls --json` to emit machine-readable structured output for editor, shell, and automation integrations.

## In Scope
- A local TypeScript command-line tool for Git worktree lifecycle management.
- Branch-based and PR-based worktree creation flows.
- Interactive prompts for selection, conflict resolution, and cleanup.
- Repository-aware path resolution and worktree discovery.
- Optional global and repo-local configuration overrides.
- A future `gji config` command for managing global defaults when configuration becomes necessary.
- Shell-friendly command behavior that composes cleanly with standard terminal tooling.
- Optional shell integration for directory-jumping behavior in interactive shells such as zsh, bash, and fish, with explicit setup through `gji init`.
- Status and synchronization workflows for one or many worktrees in the same repository.
- Structured JSON output for commands that users may want to compose with other tools.

## Out of Scope
- GUI or web interface.
- Remote repository hosting beyond Git and GitHub PR ref usage described in the README.
- A required per-repository bootstrap or initialization command before normal usage.
- Built-in editor, agent, or arbitrary command launching after worktree setup; users can compose `gji` with shell commands instead.
- Full project or dependency environment provisioning beyond worktree setup itself.
- Non-interactive bulk orchestration across many repositories.
- Deep host-specific PR/merge-request integrations beyond the current GitHub-ref-based flow unless separately specified.

## Constraints
- The implementation must work within Git worktree semantics and local filesystem constraints.
- The workflow should remain fast and opinionated rather than exposing every possible Git option.
- The default workflow should be usable immediately without mandatory setup.
- Shell composition should rely on standard terminal features rather than built-in post-setup exec hooks.
- A standalone CLI process cannot directly change the parent shell's working directory, so any "jump and cd" behavior must be implemented through shell integration or explicit shell evaluation.
- Shell configuration writes should be explicit opt-in rather than silent install-time side effects.
- Interactive flows must be safe for destructive actions such as cleanup and branch deletion.
- The initial scope should align with the commands and behaviors already described in `README.md`.
- Machine-readable output should remain stable enough for shell scripts and editor tooling to consume.
