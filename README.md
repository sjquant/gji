[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/static/img/logo-dark.svg" />
  <img src="website/static/img/logo.svg" alt="gji branch mascot" width="72" height="68" />
</picture>

# gji — Switch tasks. Keep your place.

A review comes in before your feature is finished. Open it in another directory,
then come back to the changes you left open.

`gji` is a Git worktree CLI for developers juggling unfinished tasks and PR reviews.
It creates a directory for each task, sets up supported dependencies, and moves
your shell between worktrees. Keep your usual Git commands and editor; leave
uncommitted changes where they are.

[Get started](#get-started) · [Documentation](https://gji.solaqua.dev/docs/intro) · [Is gji a fit?](https://gji.solaqua.dev/docs/comparison)

<a href="https://gji.solaqua.dev/#workflow">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset=".github/assets/readme-workflow.png" />
    <img src=".github/assets/readme-workflow.gif" alt="Start a new task, open a PR in a separate worktree, then return to feature/payments with the same two modified files." width="960" height="336" />
  </picture>
</a>

*Illustrated workflow. Shell integration is enabled; setup time is omitted.*

## Get started

You need **Node.js 20+**, Git with worktree support, and **zsh, bash, or fish**
for automatic directory changes.

```sh
npm install -g @solaqua/gji
gji init
```

Restart your shell, or load the shell configuration file shown by the wizard.
Without shell integration, the CLI cannot move your current shell.
Then, inside a repository, start from its main worktree on a named branch.
`gji go --root` takes you there.

- **Remote access:** Creating branches normally fetches from your remote, so it must be reachable.
- **Project setup:** This trial uses `--no-install` to skip dependency installation. Normally, a supported lockfile triggers installation; your project's package manager must be available, and installs take time and disk space. Configured [hooks](https://gji.solaqua.dev/docs/hooks) can still run project commands with `--no-install`; review them before using gji in an unfamiliar repository or PR.

```sh
gji doctor
gji go --root
git branch --show-current
git status --short
gji new feature/try-gji --no-install
pwd
git branch --show-current
gji go --root
git status --short
```

Choose an unused branch name if `feature/try-gji` already exists. After `new`,
your shell is in a separate directory on `feature/try-gji`. After the second
`go --root`, you're on your original branch with the same uncommitted files shown by the first
`git status`. You don't need to commit or stash them to switch tasks.

`gji back` uses navigation history. Visit a worktree with `gji go <branch>`
before relying on `back` to return to it.

For your next task, omit `--no-install` to let gji set up supported dependencies.

[Installation and shell setup](https://gji.solaqua.dev/docs/installation) · [Complete the first-worktree walkthrough](https://gji.solaqua.dev/docs/quick-start)

## Keep several tasks open

For example, while working on `feature/payments`:

```sh
gji new feature/search       # give another task its own directory
gji pr 1234                  # open a real PR from your repository
gji go feature/payments      # return to the changes you left open
```

Replace `1234` with a GitHub pull request number from your repository; `gji pr` fetches
from `origin`, which must be reachable. Each task stays in
its own worktree. Navigation moves your shell; it doesn't move changes between
branches or keep files synchronized.

| When you want to… | Run |
| --- | --- |
| Start a task | `gji new` |
| Review a PR locally | `gji pr 1234` |
| Find an open task | `gji` or `gji go` |
| Return to the last worktree | `gji back` |
| Open the current worktree in an editor | `gji open` |
| Finish a linked worktree | `gji done` |

With `gji go`, press **Tab** to browse all registered repositories. Worktrees
have predictable paths: `../worktrees/<repo>/<branch>`.

`gji done` removes a linked worktree and attempts to delete its branch. Check
for files you still need before cleanup; `gji undo` cannot recover removed
uncommitted or untracked files. Use `--keep-branch` to retain the branch.

## Make the next worktree ready for your project

- [Local files and defaults](https://gji.solaqua.dev/docs/configuration) — copy `.env.local`, choose an editor, or adjust dependency setup.
- [Hooks](https://gji.solaqua.dev/docs/hooks) — run project-specific setup after the built-in dependency install.
- [Daily workflow](https://gji.solaqua.dev/docs/daily-workflow) — review, experiment, navigate, and open editors.
- [Sync and cleanup](https://gji.solaqua.dev/docs/sync-and-cleanup) — rebase active worktrees and remove finished ones.
- [Command reference](https://gji.solaqua.dev/docs/commands) — options, JSON output, and scripting.
- [Troubleshooting](https://gji.solaqua.dev/docs/troubleshooting) — recover from setup, navigation, or install problems.

## Contributing

```sh
pnpm install
pnpm test
pnpm build
```

The CLI source is in `src/`. See [website/README.md](website/README.md) for site
and documentation development.

## License

[MIT](LICENSE)
