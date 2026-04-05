# TASKS

**## Status**
IN PROGRESS

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
- [DONE] Add `gji status --json` with stable machine-readable output for repository metadata, worktree health, and upstream divergence.
- [DONE] Implement `gji clean` to prune stale linked worktrees safely, with detached-worktree handling and clear confirmation prompts.
- [DONE] Expand README and SPEC to document `syncRemote` and `syncDefaultBranch` configuration, plus the new `gji status --json` contract.
- [DONE] Make the package publish-ready by removing `private`, adding npm metadata, constraining published files, and adding a `prepublishOnly` verification script.
- [DONE] Rewrite `README.md` for first-time adoption with install instructions, quick start, shell setup, daily workflow examples, config examples, and JSON output examples.
- [DONE] Add a minimal GitHub Actions workflow to run `pnpm test` and `pnpm build` on pushes and pull requests.
- [DONE] Rename the npm package to `@solaqua/gji` and update install and publishing references to the scoped package name.
- [DONE] Add an automated publish workflow that releases to npm when a version tag created by `npm version` is pushed.
- [DONE] Expand the release checklist to cover scoped publishing and the publish workflow prerequisites such as npm Trusted Publishing.
- [DONE] Support creating a worktree for an already-existing local branch in `gji new` without requiring the `-b` flag.
- [DONE] Add lifecycle hooks (`hooks.afterCreate`, `hooks.afterEnter`, `hooks.beforeRemove`) to config so users can run setup scripts automatically (e.g. `pnpm install`) when creating, switching to, or removing a worktree. Hooks fire from both `gji new` and `gji pr` for `afterCreate`. Support `{{branch}}`, `{{path}}`, and `{{repo}}` template variables and `GJI_BRANCH`, `GJI_PATH`, `GJI_REPO` env vars. Global and project hooks deep-merge per key. Hook failures emit a warning but do not abort the command.

- [DONE] Add `src/package-manager.ts` with lockfile-based detection logic across 20 ecosystems (~40 managers). See source file for the full entry list.

- [DONE] Add `saveLocalConfig(root: string, config: GjiConfig): Promise<string>` and `updateLocalConfigKey(root: string, key: string, value: unknown): Promise<GjiConfig>` to `src/config.ts`, mirroring the existing global equivalents but writing to `.gji.json` in the repo root. The update function must read-modify-write so that only the target key changes and all other keys are preserved. Add unit tests covering: creating the file when absent, updating an existing key, and preserving unrelated keys in an existing file.

- [DONE] Integrate package-manager detection into `gji new` and `gji pr`: after worktree creation, if no `hooks.afterCreate` is configured in the effective config and `skipInstallPrompt` is not `true` in the effective config, detect the package manager and prompt (Yes / No / Always / Never):
  - "Yes" — run the detected command once in the new worktree; do not persist anything.
  - "No" — skip once; the prompt will appear again next time.
  - "Always" — run the command, then use `updateLocalConfigKey` to write `hooks.afterCreate` into `.gji.json`, deep-merging into any existing `hooks` object so other hook keys (e.g. `afterEnter`) are preserved.
  - "Never" — use `updateLocalConfigKey` to write `skipInstallPrompt: true` into `.gji.json`.
  - Both "Always" and "Never" writes target local config only, never global config.
  - No prompt is shown when `detectPackageManager` returns null.
  - If writing to `.gji.json` fails (e.g. read-only filesystem), emit a warning to stderr but do not abort.
  - If the install command itself fails, emit a warning to stderr but do not abort (consistent with hook failure behaviour).
  Add tests covering: each prompt outcome, the skip flag suppressing the prompt, `hooks.afterCreate` already set suppressing the prompt, "Always" preserving existing non-`afterCreate` hook keys, and a filesystem write failure emitting a warning without crashing.

- [DONE] Add `src/file-sync.ts` with a `syncFiles(mainRoot: string, targetPath: string, patterns: string[]): Promise<void>` function that copies files matching each pattern (resolved relative to `mainRoot`) into the equivalent relative path under `targetPath`, creating parent directories as needed. If the target file already exists it is silently skipped (non-destructive). Skip silently when the source does not exist. Reject patterns that are absolute paths or contain `..` segments. Add unit tests for: copying a file, skipping a missing source, skipping an existing target, copying into a nested path, rejecting an absolute-path pattern, and handling an empty patterns array.

- [DONE] Integrate `syncFiles` into `gji new` and `gji pr`: read `syncFiles` (type `string[]`) from effective config; if non-empty, resolve the main worktree root via `detectRepository` and call `syncFiles(repoRoot, worktreePath, patterns)` after the worktree is created and before the `afterCreate` hook runs. If any individual file copy fails emit a warning to stderr but continue — do not abort. Document in code comments that `syncFiles` runs before `afterCreate` so synced files are available to install scripts. Note: `syncFiles` is not array-merged across global and local config — local overrides global entirely (standard shallow-merge behaviour). Add integration tests covering: config inheritance (local overrides global), a missing source file being skipped, an existing target file being skipped, and a successful copy end-to-end.

- [DONE] Add non-interactive (headless) mode: when `GJI_NO_TUI=1` or `NO_COLOR` is set in the environment, all `@clack/prompts` interactive prompts must be bypassed. Commands that require input and receive none should fail immediately with a clear error to stderr (exit code 1) rather than hanging. Specifically: `gji new` without a branch arg should error; `gji go` without a branch arg should error; `gji remove` without `--force` should error; `gji clean` without `--force` should error. Add unit tests covering that each interactive path errors correctly when `GJI_NO_TUI=1`.

- [DONE] Add `--json` output to `gji new` and `gji pr`: on success emit a single JSON object `{ branch: string, path: string }` to stdout; on error emit `{ error: string }` to stderr with a non-zero exit code. JSON mode must suppress all spinner/prompt output. Add tests for both success and error JSON shapes.

- [DONE] Add `--json` output to `gji remove`: on success emit `{ branch: string, path: string, deleted: true }`; on error emit `{ error: string }`. Add `--json` to `gji clean`: emit `{ removed: Array<{ branch: string, path: string }> }`. In all cases JSON mode must suppress interactive prompts (behave as if `GJI_NO_TUI=1`). Add tests for each.

- [ ] Add `--json` to `gji sync`: emit `{ updated: Array<{ branch: string, path: string }> }`; on error emit `{ error: string }`. JSON mode must suppress interactive prompts. Add tests.

- [ ] Add `--dry-run` to `gji new` and `gji pr`: print (or emit via `--json`) what would be created without executing any git commands or writing files. Add `--dry-run` to `gji remove` and `gji clean`: print what would be deleted without removing anything. Dry-run must be usable with `--json` so agents can validate their parameter mapping before committing to a destructive action. Add tests covering dry-run output for each command.

- [ ] Improve error messages with actionable `Hint:` lines on stderr. Key cases to cover: missing git remote (hint `git remote add origin <url>`), PR fetch failure (hint `git fetch origin` or check remote URL), worktree path conflict when not using `--force` (hint the exact `gji remove <branch>` or `gji clean` command to resolve it), and `gji go` with an unknown branch (hint `gji ls` to see available worktrees). The `Hint:` prefix must be consistent so agents can reliably parse it.

## Handoff Notes

- Bootstrap CLI, config-loading, and repository-pathing utilities now exist under `src/`; upcoming work should build on those modules rather than recreating them.
- The highest-risk areas are repository/worktree path detection, PR ref handling, and safe cleanup flows; validate those first when implementation begins.
- `gji go` cannot change the caller's directory as a plain child process; that feature needs shell integration (for example a sourced shell function installed via `gji init`) rather than only more Commander logic.
- Keep the raw binary behavior for `gji go` backward-compatible: without shell integration it should continue printing the path, while `gji go --print` remains the explicit stable scripting mode.
