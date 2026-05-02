# gji

Git worktree CLI for fast context switching. Wraps Git worktrees into an ergonomic CLI where each branch gets its own directory, `node_modules`, and terminal.

## Project Tree

```
gji/
├── src/
│   ├── cli.ts              # Entry point, command registration
│   ├── index.ts            # Public exports
│   ├── git.ts              # Git primitives
│   ├── repo.ts             # Repo/worktree state
│   ├── config.ts           # Config file handling
│   ├── paths.ts            # Path utilities
│   ├── new.ts              # `gji new` command
│   ├── open.ts             # `gji open` command
│   ├── go.ts               # `gji go` command
│   ├── pr.ts               # `gji pr` command
│   ├── ls.ts               # `gji ls` command
│   ├── remove.ts           # `gji remove` command
│   ├── sync.ts             # `gji sync` command
│   ├── clean.ts            # `gji clean` command
│   ├── init.ts             # `gji init` command
│   ├── hooks.ts            # Lifecycle hooks
│   ├── file-sync.ts        # File syncing across worktrees
│   ├── package-manager.ts  # Package manager detection
│   └── *.test.ts           # Tests alongside source
├── scripts/                # Build helpers
├── package.json
├── tsconfig.json
└── pnpm-lock.yaml
```

## Commands

See [package.json](./package.json) for all scripts.

```sh
pnpm test        # Run tests (vitest)
```
