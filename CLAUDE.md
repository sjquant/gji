# gji

Git worktree CLI for fast context switching. Wraps Git worktrees into an ergonomic CLI where each branch gets its own directory, `node_modules`, and terminal.

## Project Tree

```
gji/
├── src/
│   ├── index.ts            # Executable entry point
│   ├── cli/                # Composition root, parsing, and commands
│   │   ├── commands/       # `gji` command handlers
│   │   ├── dependencies.ts # Runtime dependency wiring
│   │   └── program.ts      # Commander registration and CLI execution
│   ├── application/        # Use cases and worktree read models
│   ├── domain/             # Business rules and domain types
│   ├── ports/              # Interfaces for external effects
│   ├── infrastructure/    # Git, filesystem, persistence, and integrations
│   ├── presentation/      # Terminal, shell, prompt, and output formatting
│   └── test-support/       # Shared test fixtures and repository helpers
├── scripts/                # Build helpers
├── package.json
├── tsconfig.json
└── pnpm-lock.yaml
```

## Dependency Direction

Keep dependencies pointed inward:

```text
cli → application → domain
 │         │
 ├──────→ ports ←──── infrastructure
 └──────→ presentation
```

- `domain` contains framework-free rules and types.
- `application` orchestrates use cases through `ports`; it must not import infrastructure.
- `infrastructure` implements ports and owns external effects.
- `presentation` formats output and prompts; it must not import infrastructure.
- `cli` is the composition root: wire infrastructure adapters into application and command handlers here.

When adding behavior, put rules in `domain`, orchestration in `application`, external effects behind `ports`/`infrastructure`, and CLI wiring in `cli`.

## Commands

See [package.json](./package.json) for all scripts.

```sh
pnpm test        # Run tests (vitest)
```
