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

- [ ] Add `src/package-manager.ts` with lockfile-based detection logic. Implement as a data-driven list of `{ signal, command, glob? }` entries checked in priority order; `glob: true` entries require a directory scan instead of `fs.access`. Export `detectPackageManager(repoRoot: string): Promise<{ name: string; installCommand: string } | null>` that returns the first match. For polyglot repos with multiple signals the first entry in the list wins; no attempt is made to enumerate all matches. Cover common managers and the no-match case in unit tests:
  - JavaScript / TypeScript
    - `pnpm-lock.yaml` → `pnpm install`
    - `yarn.lock` → `yarn install`
    - `bun.lockb` → `bun install`
    - `package-lock.json` → `npm install`
    - `deno.json` / `deno.jsonc` → `deno cache`
  - Python
    - `poetry.lock` → `poetry install`
    - `uv.lock` → `uv sync`
    - `Pipfile.lock` → `pipenv install`
    - `pdm.lock` → `pdm install`
    - `conda-lock.yml` → `conda-lock install`
    - `environment.yml` → `conda env update --file environment.yml`
  - R
    - `renv.lock` → `Rscript -e 'renv::restore()'`
  - Rust
    - `Cargo.lock` → `cargo build`
  - Go
    - `go.sum` → `go mod download`
  - Ruby
    - `Gemfile.lock` → `bundle install`
  - PHP
    - `composer.lock` → `composer install`
  - Elixir / Erlang
    - `mix.lock` → `mix deps.get`
    - `rebar.lock` → `rebar3 deps`
  - Dart / Flutter
    - `pubspec.lock` → `dart pub get`
  - Java / Kotlin / Scala
    - `pom.xml` → `mvn install`
    - `gradlew` → `./gradlew build` (check wrapper first; fall back to `gradle build` if absent)
    - `build.sbt` → `sbt compile`
  - .NET (C# / F# / VB)
    - `*.sln` → `dotnet restore` (glob)
    - `*.csproj` / `*.fsproj` / `*.vbproj` → `dotnet restore` (glob)
  - Swift
    - `Package.swift` → `swift package resolve`
  - Haskell
    - `stack.yaml` → `stack build`
    - `cabal.project` / `*.cabal` → `cabal install --only-dependencies` (glob)
  - Clojure
    - `deps.edn` → `clojure -P`
    - `project.clj` → `lein deps`
  - OCaml
    - `dune-project` → `dune build`
  - Julia
    - `Manifest.toml` → `julia --project -e 'using Pkg; Pkg.instantiate()'`
  - Nim
    - `*.nimble` → `nimble install` (glob)
  - Crystal
    - `shard.yml` → `shards install`
  - Perl
    - `cpanfile` → `cpanm --installdeps .`
  - Zig
    - `build.zig.zon` → `zig build`
  - C / C++
    - `vcpkg.json` → `vcpkg install`
    - `conanfile.py` / `conanfile.txt` → `conan install .`
  - Nix
    - `flake.nix` → `nix develop`
    - `shell.nix` → `nix-shell`
  - Terraform / OpenTofu
    - `terraform.lock.hcl` → `terraform init`

- [ ] Integrate package-manager detection into `gji new` and `gji pr`: after worktree creation, if no `hooks.afterCreate` is configured and `skipInstallPrompt` is not `true` in effective config, detect the package manager and prompt (Yes / No / Always / Never). "Always" merges `hooks.afterCreate` with the detected command into local config (`.gji.json`), overwriting any existing `afterCreate` value but preserving other hook keys; "Never" persists `skipInstallPrompt: true` to local config; both `skipInstallPrompt` and `hooks.afterCreate` are local-config-only and never written to global config. "Yes" runs once without persisting. No prompt is shown when detection returns null. Add tests covering each prompt outcome, the skip flag, the hooks.afterCreate override, and the case where `hooks.afterCreate` is already set (prompt is suppressed).

- [ ] Add `src/file-sync.ts` with a `syncFiles(mainRoot: string, targetPath: string, patterns: string[]): Promise<void>` function that copies files matching each pattern (resolved relative to `mainRoot`) into the equivalent relative path under `targetPath`, creating parent directories as needed. Skip silently when the source does not exist. Add unit tests for copying a file, skipping a missing source, copying into a nested path, and handling an empty patterns array.

- [ ] Integrate `syncFiles` into `gji new` and `gji pr`: read `syncFiles` (type `string[]`) from effective config; if non-empty, resolve the main worktree root via `detectRepository` and call `syncFiles(repoRoot, worktreePath, patterns)` after the worktree is created and before the `afterCreate` hook runs. Add integration tests covering config inheritance (global vs. local), a missing source file being skipped, and a successful copy end-to-end.

## Handoff Notes

- Bootstrap CLI, config-loading, and repository-pathing utilities now exist under `src/`; upcoming work should build on those modules rather than recreating them.
- The highest-risk areas are repository/worktree path detection, PR ref handling, and safe cleanup flows; validate those first when implementation begins.
- `gji go` cannot change the caller's directory as a plain child process; that feature needs shell integration (for example a sourced shell function installed via `gji init`) rather than only more Commander logic.
- Keep the raw binary behavior for `gji go` backward-compatible: without shell integration it should continue printing the path, while `gji go --print` remains the explicit stable scripting mode.
