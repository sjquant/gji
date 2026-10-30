<picture>
  <source media="(prefers-color-scheme: dark)" srcset="website/static/img/logo-dark.svg" />
  <img src="website/static/img/logo.svg" alt="gji branch mascot" width="72" height="68" />
</picture>

# gji — Switch tasks. Keep your place.

Open a new task or review a PR. Your current work stays right where you left it.

`gji` is a Git worktree CLI for developers who keep more than one task open.
Each task gets a separate working directory and dependency installation, so
switching tasks doesn't mean packing up your changes first. Keep using your
usual Git commands, editor, and coding tools inside each worktree.

[Get started](#get-started) · [Documentation](https://gji.solaqua.dev/docs/intro) · [Is gji a fit?](https://gji.solaqua.dev/docs/comparison)

<a href="https://gji.solaqua.dev/#workflow">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset=".github/assets/readme-workflow.png" />
    <img src=".github/assets/readme-workflow.gif" alt="Start a new task, open a PR in a separate worktree, then return to feature/payments with the same two modified files." width="960" height="336" />
  </picture>
</a>

*Illustrated workflow. Shell integration is enabled; setup time is omitted.*

## Get started

You need **Node.js 18+**, Git with worktree support, and **zsh, bash, or fish**
for automatic directory changes.

```sh
npm install -g @solaqua/gji
gji init
```

Restart your shell, or load the shell configuration file shown by the wizard.
Then, inside a repository you already work in:

```sh
gji doctor
gji new feature/try-gji
gji back
```

You just opened a separate worktree and returned to your previous one. Any
uncommitted files you left there stay there. New worktrees install dependencies
automatically when a supported lockfile is detected, so the first setup can take
time. Use `--no-install` to skip it for one task.

[Installation and shell setup](https://gji.solaqua.dev/docs/installation) · [Complete the first-worktree walkthrough](https://gji.solaqua.dev/docs/quick-start)

## Keep several tasks open

For example, while working on `feature/payments`:

```sh
gji new feature/search       # give another task its own directory
gji pr 1234                  # open a real PR from your repository
gji go feature/payments      # return to the changes you left open
```

Replace `1234` with a GitHub pull request in your repository. Each task stays in
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

## Make the next worktree ready for your project

- [Local files and defaults](https://gji.solaqua.dev/docs/configuration) — copy `.env.local`, choose an editor, or adjust dependency setup.
- [Hooks](https://gji.solaqua.dev/docs/hooks) — run project-specific setup after the built-in dependency install.
- [Daily workflow](https://gji.solaqua.dev/docs/daily-workflow) — review, experiment, navigate, and open editors.
- [Sync and cleanup](https://gji.solaqua.dev/docs/sync-and-cleanup) — rebase active worktrees and remove finished ones. Cleanup can delete branches; undo does not recover uncommitted files.
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
