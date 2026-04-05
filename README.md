# gji — Git worktrees without the hassle

> Jump between tasks instantly. No stash. No reinstall. No mess.

`gji` wraps Git worktrees into a fast, ergonomic CLI. Each branch gets its own directory, its own `node_modules`, and its own terminal — so switching context is a single command instead of a ritual.

```sh
gji new feature/payment-refactor   # new branch + worktree, cd in
gji pr 1234                        # review PR in isolation, cd in
gji go main                        # jump back, shell changes directory
gji remove feature/payment-refactor
```

---

**If `gji` has saved you from a `git stash` spiral, a ⭐ on [GitHub](https://github.com/sjquant/gji) means a lot — it helps other developers find this tool.**

---

## The problem

You are deep in a feature branch. A colleague asks for a quick review. You:

1. stash your changes
2. checkout their branch
3. wait for `pnpm install` to finish
4. review
5. checkout back
6. pop your stash
7. realize something is broken

**Or you use `gji` and it is just `gji pr 1234`.**

## Install

```sh
npm install -g @solaqua/gji
```

Then add shell integration so `gji go`, `gji new`, and `gji remove` can change your directory:

```sh
# zsh
echo 'eval "$(gji init zsh)"' >> ~/.zshrc && source ~/.zshrc

# bash
echo 'eval "$(gji init bash)"' >> ~/.bashrc && source ~/.bashrc
```

## Quick start

```sh
# start a new task
gji new feature/dark-mode

# review a pull request
gji pr 1234

# see what's open
gji status

# jump between worktrees
gji go feature/dark-mode
gji go main

# clean up when done
gji remove feature/dark-mode
```

Worktrees land at a deterministic path so your editor bookmarks and scripts always know where to look:

```
../worktrees/<repo>/<branch>
```

## Daily workflow

```sh
gji new feature/auth-refactor     # new branch + worktree
gji new --detached                # scratch space, auto-named

gji pr 1234                       # checkout PR locally
gji pr https://github.com/org/repo/pull/1234  # or paste the URL

gji go feature/auth-refactor      # jump to a worktree
gji root                          # jump to repo root

gji status                        # health overview + ahead/behind counts
gji ls                            # compact list

gji sync                          # rebase current worktree onto default branch
gji sync --all                    # rebase every worktree

gji clean                         # interactive bulk cleanup
gji remove feature/auth-refactor  # remove one worktree and its branch
```

## Shell setup

Without shell integration `gji` prints paths and exits — which is fine for scripts but means it cannot `cd` you into a new worktree. Install the integration once:

```sh
gji init zsh   # prints the shell function, review it if you like
```

To install automatically:

```sh
# zsh
echo 'eval "$(gji init zsh)"' >> ~/.zshrc

# bash
echo 'eval "$(gji init bash)"' >> ~/.bashrc
```

After a reinstall or upgrade, re-source to pick up changes:

```sh
eval "$(gji init zsh)"
```

For scripts that need the raw path, use `--print`:

```sh
path=$(gji go --print feature/dark-mode)
path=$(gji root --print)
```

## Commands

| Command | Description |
|---|---|
| `gji new [branch] [--detached] [--json]` | create branch + worktree, cd in |
| `gji pr <ref> [--json]` | fetch PR ref, create worktree, cd in |
| `gji go [branch] [--print]` | jump to a worktree |
| `gji root [--print]` | jump to the main repo root |
| `gji status [--json]` | repo overview, worktree health, ahead/behind |
| `gji ls [--json]` | list active worktrees |
| `gji sync [--all]` | fetch and rebase worktrees onto default branch |
| `gji clean [--force] [--json]` | interactively prune stale worktrees |
| `gji remove [branch] [--force] [--json]` | remove a worktree and its branch |
| `gji config [get\|set\|unset] [key] [value]` | manage global defaults |
| `gji init [shell]` | print or install shell integration |

## Configuration

No setup required. Optional config lives in:

- `~/.config/gji/config.json` — global defaults
- `.gji.json` — repo-local overrides (takes precedence)

### Available keys

| Key | Description |
|---|---|
| `branchPrefix` | prefix added to new branch names (e.g. `"feature/"`) |
| `syncRemote` | remote for `gji sync` (default: `origin`) |
| `syncDefaultBranch` | branch to rebase onto (default: remote `HEAD`) |
| `syncFiles` | files to copy from main worktree into each new worktree |
| `skipInstallPrompt` | `true` to disable the auto-install prompt permanently |
| `hooks` | lifecycle scripts (see [Hooks](#hooks)) |

```json
{
  "branchPrefix": "feature/",
  "syncRemote": "upstream",
  "syncDefaultBranch": "main",
  "syncFiles": [".env.example", ".nvmrc"]
}
```

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
    "afterCreate": "pnpm install",
    "afterEnter": "echo 'switched to {{branch}}'",
    "beforeRemove": "pnpm run cleanup"
  }
}
```

| Hook | When it runs |
|---|---|
| `afterCreate` | after `gji new` or `gji pr` creates a worktree |
| `afterEnter` | after `gji go` switches to a worktree |
| `beforeRemove` | before `gji remove` deletes a worktree |

Hooks receive `{{branch}}`, `{{path}}`, `{{repo}}` as template variables and `GJI_BRANCH`, `GJI_PATH`, `GJI_REPO` as environment variables. A failing hook emits a warning but never aborts the command.

Global and repo-local hooks deep-merge per key:

```jsonc
// ~/.config/gji/config.json
{ "hooks": { "afterCreate": "nvm use", "afterEnter": "echo hi" } }

// .gji.json
{ "hooks": { "afterCreate": "pnpm install" } }

// effective
{ "hooks": { "afterCreate": "pnpm install", "afterEnter": "echo hi" } }
```

## Install prompt

When `gji new` or `gji pr` creates a worktree, `gji` detects the project's package manager from its lockfile and offers to run the install command:

```
Run `pnpm install` in the new worktree?
› Yes       run once
  No        skip this time
  Always    save as afterCreate hook
  Never     disable this prompt for this repo
```

**Always** saves `hooks.afterCreate` to `.gji.json`; **Never** writes `skipInstallPrompt: true`. Both are local-only — global config is never modified.

## JSON output

Every mutating command supports `--json` for scripting and AI agent use. Success goes to stdout, errors go to stderr with exit code 1.

```sh
# create
gji new --json feature/dark-mode
# → { "branch": "feature/dark-mode", "path": "/…/worktrees/repo/feature/dark-mode" }

# fetch PR
gji pr --json 1234
# → { "branch": "pr/1234", "path": "/…/worktrees/repo/pr/1234" }

# remove
gji remove --json --force feature/dark-mode
# → { "branch": "feature/dark-mode", "path": "/…", "deleted": true }

# bulk clean
gji clean --json --force
# → { "removed": [{ "branch": "...", "path": "..." }, …] }

# error shape (any command)
# stderr → { "error": "branch argument is required" }
```

`--json` suppresses all interactive prompts. `--force` is required for `remove` and `clean` in JSON mode. `branch` is `null` for detached worktrees.

`gji ls --json` and `gji status --json` also produce structured output — see `gji status --json | jq` for the full schema.

## Non-interactive / CI mode

```sh
GJI_NO_TUI=1 gji new feature/ci-branch
GJI_NO_TUI=1 gji remove --force feature/ci-branch
GJI_NO_TUI=1 gji clean --force
```

`GJI_NO_TUI=1` disables all prompts. Commands that need confirmation require `--force`. `--json` implies the same behaviour.

## Notes

- Works from either the main repo root or inside any linked worktree
- The current worktree is never offered as a `gji clean` candidate
- `gji pr` parses GitHub, GitLab, and Bitbucket URLs but always fetches via `refs/pull/<number>/head` from `origin`

## License

MIT
