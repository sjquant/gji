# gji — Git worktrees without the hassle

> Jump between tasks instantly. No stash. No branch juggling. No mess.

`gji` wraps Git worktrees into a fast, ergonomic CLI. Each branch gets its own directory, its own `node_modules`, and its own terminal — so switching context is a single command instead of a ritual.

That matters even more in AI-assisted workflows, where one repository often has several active tasks in parallel: your main feature, a PR review, a scratch experiment, or an agent-driven refactor. `gji` keeps each one isolated and easy to enter.

```sh
gji new feature/payment-refactor   # new branch + worktree, cd in
gji pr 1234                        # review PR in isolation, cd in
gji pr open                         # open the PR for the current worktree
gji go main                        # jump back, shell changes directory
gji done feature/payment-refactor
```

## Before / After

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>Before</strong><br />
      <img src=".github/assets/readme-before.gif" alt="Traditional branch review flow with git stash, branch switching, reinstalling dependencies, and a merge conflict on stash pop." />
    </td>
    <td width="50%" valign="top">
      <strong>After</strong><br />
      <img src=".github/assets/readme-after.gif" alt="gji creating an isolated pull request worktree from the terminal in a few commands." />
    </td>
  </tr>
</table>

Maintainer note: `pnpm generate:readme-demos` currently expects macOS, `zsh`, Google Chrome, `asciinema`, and `ffmpeg`.

---

**If `gji` has saved you from a `git stash` spiral, a ⭐ on [GitHub](https://github.com/sjquant/gji) means a lot — it helps other developers find this tool.**

---

## The problem

You are deep in a feature branch. A colleague asks for a quick review. You:

1. stash your changes
2. checkout their branch
3. wait for `npm install` to finish
4. review
5. checkout back
6. pop your stash
7. realize something is broken

**Or you use `gji`, run `gji pr 1234`, and let the fresh worktree boot itself.**

## Why it matters more now

AI increases the amount of parallel work around a codebase.

It is increasingly normal to have:

1. your own branch open
2. another branch for review
3. a scratch space for testing an AI-generated change
4. a separate worktree for validating a risky migration or refactor

That makes Git worktrees more important, because a single shared checkout becomes the bottleneck. `gji` turns worktrees into a daily workflow instead of a Git power-user feature.

## Install

```sh
npm install -g @solaqua/gji
```

Then run the guided setup in an interactive terminal:

```sh
gji init
# restart your shell, or source the rc file shown by the wizard
gji doctor
```

The wizard installs shell integration, completions, and an available editor. In a non-interactive environment, use the existing explicit shell command instead:

```sh
gji init zsh --write
```

## Quick start

```sh
# start a new task
gji new feature/dark-mode

# start a task and open it straight in your editor
gji new feature/dark-mode --open --editor cursor

# review a pull request
gji pr 1234
gji pr open                         # open the PR for the current worktree
gji pr open --select                # choose a PR from any linked worktree
gji pr open feature/auth-refactor   # open the PR for a branch
gji pr open '#1234'                 # open an open PR directly

# see what's open
gji status

# jump between worktrees
gji go feature/dark-mode
gji go main

# open the current worktree in an editor
gji open
gji open --select                # choose another worktree interactively
gji open feature/dark-mode --editor code

# finish a worktree when done
gji done feature/dark-mode
```

Worktrees land at a deterministic path so your editor bookmarks and scripts always know where to look:

```
../worktrees/<repo>/<branch>
```

Set `worktreePath` in your config to use a different base (e.g. `"~/worktrees"` → `~/worktrees/<branch>`).

## Daily workflow

```sh
gji new feature/auth-refactor     # new branch + worktree
gji new feature/auth-tests --from-current  # branch from the current worktree
gji new --detached                # scratch space, auto-named

gji pr 1234                       # checkout PR locally
gji pr https://github.com/org/repo/pull/1234  # or paste the URL

gji go feature/auth-refactor      # jump to a worktree
gji go teammate-branch            # open an existing local or remote branch
gji go -                          # return to the previous worktree
gji go --root                     # return to the main repository checkout
gji root                          # jump to repo root
gji warp repo-a/main              # compatibility spelling for cross-repo navigation
gji back                          # return through navigation history
gji history                       # inspect recent navigation

# with no branch, the chooser starts in the current repo; press Tab for all repos

gji status                        # health overview + ahead/behind counts
gji ls                            # list with status/upstream/last commit
gji ls --compact                  # branch/path only

gji sync                          # rebase current worktree onto default branch
gji sync --all                    # rebase every worktree

gji clean                         # interactive bulk cleanup
gji clean --stale                 # only target safe stale cleanup candidates
gji done feature/auth-refactor    # finish one worktree and its branch

gji trigger-hook afterCreate      # re-run setup in the current worktree
```

## Comparison

`gji` sits between raw Git primitives and larger Git or repository tools:

- **vs raw `git worktree`**: same underlying capability, but with branch-first commands, shell handoff, PR checkout, hooks, sync, and cleanup built into the workflow
- **vs `lazygit`**: `lazygit` is a broad Git UI; `gji` is narrower and faster for opening, jumping between, and removing isolated branch directories
- **vs `ghq`**: `ghq` organizes where repositories live; `gji` organizes which branch, PR, or worktree you should be in once you are inside one

Use `gji` when your bottleneck is repeated context switching between features, reviews, and maintenance work without disturbing what is already open.

It is especially useful when those contexts are happening in parallel across both human and AI-assisted work.

See the full comparison in [website/docs/comparison.mdx](./website/docs/comparison.mdx).

## Shell setup

Without shell integration `gji` prints paths and exits — which is fine for scripts but means it cannot `cd` you into a new worktree. Install the integration, completions, and an editor once with:

```sh
gji init
gji doctor
```

`gji init` is interactive. For dotfiles or CI, the explicit shell commands remain available and preserve their existing output:

```sh
# zsh
echo 'eval "$(gji init zsh)"' >> ~/.zshrc

# bash
echo 'eval "$(gji init bash)"' >> ~/.bashrc

# fish
gji init fish --write
```

Install completions separately so your shell rc stays small:

```sh
# zsh
mkdir -p ~/.zsh/completions
gji completion zsh > ~/.zsh/completions/_gji
# add this before running compinit in ~/.zshrc
fpath=(~/.zsh/completions $fpath)

# bash
mkdir -p ~/.local/share/bash-completion/completions
gji completion bash > ~/.local/share/bash-completion/completions/gji

# fish
mkdir -p ~/.config/fish/completions
gji completion fish > ~/.config/fish/completions/gji.fish
```

After a reinstall or upgrade, refresh both the wrapper and the completion file:

```sh
# zsh
eval "$(gji init zsh)"
gji completion zsh > ~/.zsh/completions/_gji
# if zsh is already running, refresh completion discovery too
autoload -Uz compinit && compinit

# fish
gji init fish --write
gji completion fish > ~/.config/fish/completions/gji.fish
source ~/.config/fish/config.fish
```

For scripts that need the raw path, use `--print`:

```sh
path=$(gji go --print feature/dark-mode)
path=$(gji root --print)
```

## Commands

| Command | Description |
|---|---|
| `gji new [branch] [--from-current] [--detached] [--take] [--copy] [--force] [--open] [--editor <cli>] [--dry-run] [--json]` | create branch + worktree, optionally carrying uncommitted changes |
| `gji done [branch] [--force] [--keep-branch] [--json]` | safely finish a linked worktree and return |
| `gji undo [id] [--list] [--json]` | restore a journaled cleanup without overwriting work |
| `gji pr <ref> [--json]` | fetch PR ref, create worktree, cd in |
| `gji pr open [branch|#N] [--select]` | open the current worktree PR, or choose a linked worktree with `--select` |
| `gji back [n] [--print]` | return to a previous worktree from navigation history |
| `gji history [--json]` | show navigation history |
| `gji warp [branch] [--print] [--json]` | compatibility spelling for cross-repository navigation |
| `gji open [branch] [--select] [--editor <cli>] [--save] [--workspace]` | open the current or selected worktree in an editor |
| `gji go [branch] [--root] [--print] [--json]` | resolve and jump to a worktree, branch, remote, or PR |
| `gji root [--print]` | jump to the main repo root |
| `gji status [--json]` | repo overview, worktree health, ahead/behind |
| `gji ls [--compact] [--json]` | list active worktrees |
| `gji sync [--all]` | fetch and rebase worktrees onto default branch |
| `gji sync-files [list\|add\|remove] [paths...]` | manage local files copied into new worktrees |
| `gji clean [--stale] [--force] [--dry-run] [--json]` | interactively prune linked worktrees |
| `gji remove [branch] [--force] [--dry-run] [--json]` (`rm`) | **deprecated**; use `gji done` for one worktree or `gji clean` for bulk cleanup |
| `gji trigger-hook <hook>` | run a hook in the current worktree |
| `gji config [get\|set\|unset] [key] [value]` | manage global defaults |
| `gji init [shell]` | interactively set up onboarding, or print/install a shell wrapper |
| `gji doctor [--json] [--fix] [--yes]` | check installation and configuration health; optionally remove stale repository entries |
| `gji completion [shell]` | print shell completion definitions |

The repository registry records projects that gji has visited so `go`, `warp`,
and the chooser can resolve worktrees across repositories. It is advisory
metadata: missing paths are skipped and `gji doctor --fix` can remove stale
entries.

`gji remove` and its `rm` alias remain available during the deprecation window,
but print a migration warning in human-readable mode. Use `gji done <branch>`
to finish one linked worktree or `gji clean` to prune several worktrees.

## Configuration

No setup required. Optional config lives in:

- `~/.config/gji/config.json` — global defaults
- `.gji.json` — repo-local overrides (takes precedence)

### Available keys

| Key | Description |
|---|---|
| `branchPrefix` | prefix added to new branch names (e.g. `"feature/"`) |
| `editor` | default editor CLI for `gji open` and `gji new --open` (e.g. `"cursor"`, `"code"`, `"zed"`); set automatically with `gji open --save` |
| `worktreePath` | base directory for new worktrees (absolute or `~/…`); overrides the default `../worktrees/<repo>/` layout |
| `syncRemote` | remote for `gji sync` (default: `origin`) |
| `syncDefaultBranch` | branch to rebase onto (default: remote `HEAD`) |
| `syncFiles` | files to copy from main worktree into each new worktree; use global per-repo config for private files |
| `syncDirs` | arbitrary directories to clone with filesystem copy-on-write before sync files |
| `dependencyBootstrap` | dependency/build-state policy: `off`, `cow-then-repair`, or `install-only` |
| `dependencyBuildCommand` | optional Cargo repair command used by `dependencyBootstrap` (default: `cargo check`) |
| `skipInstallPrompt` | `true` to disable the auto-install prompt permanently |
| `installSaveTarget` | `"local"` or `"global"` — where dependency policy and legacy **Always**/**Never** choices are persisted (default: `"local"`); set during `gji init <shell> --write` |
| `hooks` | lifecycle scripts (see [Hooks](#hooks)) |
| `repos` | per-repo overrides inside the global config (see below) |

```json
{
  "branchPrefix": "feature/",
  "syncRemote": "upstream",
  "syncDefaultBranch": "main",
  "syncFiles": [".env.example", ".nvmrc"],
  "syncDirs": [".next"],
  "dependencyBootstrap": "cow-then-repair"
}
```

### Syncing local files

Use `syncFiles` for private, gitignored, or machine-local files that every new worktree needs, such as `.env.local` or `.npmrc`. `gji new` copies these files from the main worktree before install hooks run, skips missing source files, and does not overwrite files that already exist in the target worktree.

For private files, prefer the `sync-files` command. It writes to your global per-repo config so secret filenames do not need to be committed to `.gji.json`:

```sh
gji sync-files add .env.local .npmrc
gji sync-files list
gji sync-files remove .npmrc
```

This stores:

```json
{
  "repos": {
    "/home/me/code/my-repo": {
      "syncFiles": [".env.local"]
    }
  }
}
```

### Instant directory bootstrap

Use `syncDirs` for advanced, arbitrary directories that should be available immediately in each new worktree. Dependency adapters discover their own project-local targets, so you do not need to list `node_modules`, `.venv`, or `target` here:

```json
{
  "syncDirs": [".next", ".cache"]
}
```

`gji new` clones these directories with APFS copy-on-write on macOS or mandatory reflinks on Linux, before `syncFiles`. It never falls back to a slow ordinary copy. Unsupported filesystems, external symlink targets, missing sources, and existing destinations are skipped safely; failed CoW attempts are cached in `~/.config/gji/state.json` so repeated worktree creation does not keep waiting on the same unsupported filesystem. `syncDirs` is generic: it does not know or special-case package managers.

Paths are relative to the repository root. Absolute paths, `..` segments, and `.git` paths are rejected in all three config layers.

The human output includes clone timing; dry-run can provide source-size estimates:

```text
⚡ cloned .next (size unavailable → 1.2s)
```

Use `dependencyBootstrap` when a package manager or build cache needs a reusable seed followed by authoritative repair:

```json
{
  "dependencyBootstrap": "cow-then-repair"
}
```

`cow-then-repair` supports pnpm (`node_modules` + `pnpm install --frozen-lockfile`), Yarn (`node_modules` + `yarn install --immutable`), uv (`.venv` + `uv sync --locked`), Cargo (`target` + the configured `dependencyBuildCommand`, or `cargo check`), and Bundler (`vendor/bundle` + `bundle install`). npm is install-only (`npm ci`) because it can delete an existing dependency tree; it never seeds `node_modules`. Only project-local targets are eligible, so global Ruby gems and package-manager caches are never cloned. CoW failure never triggers ordinary copying: repair runs from an empty target instead. The lifecycle is `CoW seed → syncFiles → repair/install → after-create`; a sync-file failure stops repair, install prompts, and hooks. A successful dependency seed is reported as `reused and repaired`, not as an install skip.

When a supported lockfile is detected and no `dependencyBootstrap` policy is configured, interactive `gji new` and `gji pr` ask which policy to persist: **Reuse and repair (recommended)**, **Install fresh each time**, or **Skip dependency setup**. The prompt explains the detected tool—for example, pnpm reuses local `node_modules` through CoW and then runs `pnpm install --frozen-lockfile`. The choice is saved locally or in the per-repo global config according to `installSaveTarget`. Headless, JSON, and dry-run commands never prompt and retain the safe `off` default.

Ecosystems dominated by global caches, such as Gradle, Maven, and Go, are not seeded until a safe project-local target and deterministic repair rule are available. Future adapters can add Composer, Poetry/PDM, Mix, Dart/Flutter, or .NET without changing `syncDirs`.

Use `gji new --dry-run` to see the directories and estimated sizes without creating anything. `gji new --json` adds a `cloned` array and structured `dependencyBootstrap` events, including machine-readable reasons for skips and failures. If bootstrap fails, the JSON error includes the created worktree path; text mode prints the same path and a cleanup hint. The benchmark target for a 2 GB dependency tree on supported APFS/Btrfs or XFS filesystems is under 5 seconds; benchmark your repository locally because filesystem and storage behavior determine the result.

### Per-repo overrides in global config

If you work across many repositories, you can scope config to a specific repo inside `~/.config/gji/config.json` without adding a `.gji.json` to that repo:

```json
{
  "branchPrefix": "feature/",
  "repos": {
    "/home/me/code/my-repo": {
      "branchPrefix": "fix/",
      "hooks": {
        "afterCreate": "npm install"
      }
    }
  }
}
```

Precedence (lowest → highest): **global defaults → per-repo global → local `.gji.json`**. Hooks from all three layers are merged per key — different keys all apply, same key the higher-precedence layer wins.

### Config commands

```sh
gji config get
gji config get branchPrefix
gji config set branchPrefix feature/
gji config unset branchPrefix
```

## Hooks

Run scripts automatically at key lifecycle moments:

```json
{
  "hooks": {
    "afterCreate": ["pnpm", "install"],
    "afterEnter": ["printf", "switched to %s\n", "{{branch}}"],
    "beforeRemove": "pnpm run cleanup"
  }
}
```

| Hook | When it runs |
|---|---|
| `afterCreate` | after `gji new` or `gji pr` creates a worktree |
| `afterEnter` | after `gji go` switches to a worktree |
| `beforeRemove` | before `gji done` or `gji clean` deletes a worktree |

Hooks receive `{{branch}}`, `{{path}}`, `{{repo}}` as template variables and `GJI_BRANCH`, `GJI_PATH`, `GJI_REPO` as environment variables. A failing hook emits a warning but never aborts the command.

Prefer argv-array hooks for simple commands:

```json
{
  "hooks": {
    "afterCreate": ["pnpm", "install"],
    "afterEnter": ["printf", "switched to %s at %s\n", "{{branch}}", "{{path}}"]
  }
}
```

Array hooks run without a shell and pass each array item as exactly one argument. Use string hooks only when you need shell features like `&&`, pipes, redirects, shell functions, or `nvm use`.

Template values are interpolated before the shell parses string hooks, so avoid putting `{{branch}}`, `{{path}}`, or `{{repo}}` directly into shell strings. For shell-string hooks, the safer pattern is to use the environment variables and double-quote each expansion:

```json
{
  "hooks": {
    "afterCreate": "pnpm install && printf 'ready: %s\n' \"$GJI_PATH\""
  }
}
```

Avoid unquoted template values in shell strings, such as `echo {{branch}}` or `cd {{path}}`.

Hooks from all three config layers merge per key — different keys from different layers both apply, same key the higher-precedence layer wins:

```jsonc
// ~/.config/gji/config.json
{ "hooks": { "afterCreate": "nvm use", "afterEnter": "echo hi" } }

// per-repo entry in ~/.config/gji/config.json
{ "repos": { "/my/repo": { "hooks": { "afterCreate": "npm install" } } } }

// .gji.json
{ "hooks": { "beforeRemove": "echo bye" } }

// effective
{ "hooks": { "afterCreate": "npm install", "afterEnter": "echo hi", "beforeRemove": "echo bye" } }
```

### Triggering hooks manually

Run any hook in the current worktree on demand:

```sh
gji trigger-hook afterCreate   # re-run the setup script
gji trigger-hook afterEnter    # re-run the enter script
gji trigger-hook beforeRemove  # dry-run the cleanup script
```

This is useful after cloning on a new machine, recovering a broken worktree, or letting an AI agent bootstrap an already-existing worktree without needing interactive prompts.

## Install prompt

For supported lockfiles, the dependency policy prompt above is the primary setup choice. Keep `after-create` hooks for project-specific work such as `pnpm run generate`, code generation, local-service setup, or environment-specific commands; hooks are not a second dependency-bootstrap configuration.

Projects without a supported dependency adapter can still use the legacy one-shot install prompt:

```
Run `pnpm install` in the new worktree?
› Yes       run once
  No        skip this time
  Always    save as afterCreate hook
  Never     disable this prompt for this repo
```

**Always** saves `hooks.afterCreate`; **Never** writes `skipInstallPrompt: true`. Where they are saved depends on `installSaveTarget` (see [Available keys](#available-keys)) — defaults to `.gji.json`.

`syncDirs` remains generic and never suppresses installation or repair. To automate supported dependency/build setup, use `dependencyBootstrap`; the adapter always runs its lockfile/build repair after `syncFiles`. Explicit policies in global defaults, per-repo global config, or `.gji.json` always win over prompting.

## JSON output

Every mutating command supports `--json` for scripting and AI agent use. Success goes to stdout, errors go to stderr with exit code 1.

```sh
# create
gji new --json feature/dark-mode
# → { "branch": "feature/dark-mode", "path": "/…/worktrees/repo/feature/dark-mode", "repository": { "name": "repo", "root": "/…/repo" } }

# fetch PR
gji pr --json 1234
# → { "branch": "pr/1234", "path": "/…/worktrees/repo/pr/1234", "repository": { "name": "repo", "root": "/…/repo" } }

# resolve an existing destination without changing directories
gji go --json feature/auth-refactor
# → { "branch": "feature/auth-refactor", "path": "/…/worktrees/repo/feature/auth-refactor", "repository": { "name": "repo", "root": "/…/repo" } }

# detailed list
gji ls --json
# → [{ "branch": "...", "status": "clean", "upstream": { "kind": "tracked", ... }, ... }]

# finish one worktree
gji done --json --force feature/dark-mode
# → { "branch": "feature/dark-mode", "path": "/…", "deleted": true }

# bulk clean
gji clean --json --force
# → { "removed": [{ "branch": "...", "path": "..." }, …] }

# stale-only clean
gji clean --stale --json --force
# → { "removed": [{ "branch": "...", "path": "..." }, …] }

# error shape (any command)
# stderr → { "error": "branch argument is required" }
```

`gji clean --stale` limits cleanup to clean branch worktrees whose upstream is gone and whose branch is already merged into the configured or remote default branch.

`--json` suppresses all interactive prompts. Navigation results include a `repository` object with the stable repository `root` and display `name`. `--force` is required for `done` and `clean` in JSON mode. `branch` is `null` for detached worktrees.

`gji ls --json` and `gji status --json` also produce structured output — see `gji status --json | jq` for the full schema.

## Non-interactive / CI mode

```sh
GJI_NO_TUI=1 gji new feature/ci-branch
GJI_NO_TUI=1 gji done --force feature/ci-branch
GJI_NO_TUI=1 gji clean --force
```

`GJI_NO_TUI=1` disables all prompts. Commands that need confirmation require their non-interactive approval flag (`--force` for cleanup commands, `--yes` for `doctor --fix`). `--json` implies the same behaviour.

`gji pr open --select` requires an interactive terminal; plain `gji pr open` opens the PR for the current worktree without prompting.
If the current worktree has no open PR or has multiple open PRs in headless mode, pass `gji pr open <branch|#N>` explicitly.

Update notifications are also suppressed automatically in non-interactive and `--json` runs. Users can opt out explicitly with `NO_UPDATE_NOTIFIER=1` or `--no-update-notifier`.

## Notes

- Works from either the main repo root or inside any linked worktree
- The current worktree is never offered as a `gji clean` candidate
- `gji pr` fetches from `origin` using the first matching forge ref namespace: GitHub `refs/pull/<number>/head`, GitLab `refs/merge-requests/<number>/head`, then Bitbucket `refs/pull-requests/<number>/from`
- `gji pr open` reads open PRs from the `origin` forge (GitHub, GitLab, or Bitbucket), preferring an installed authenticated provider CLI and falling back to its public API

## License

MIT
