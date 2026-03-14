import { Command } from 'commander';

import { runGoCommand } from './go.js';
import { runLsCommand } from './ls.js';
import { runNewCommand } from './new.js';
import { runPrCommand } from './pr.js';
import { runRootCommand } from './root.js';

export interface RunCliOptions {
  cwd?: string;
  stderr?: (chunk: string) => void;
  stdout?: (chunk: string) => void;
}

export interface RunCliResult {
  exitCode: number;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('gji')
    .description('Context switching without the mess.')
    .showHelpAfterError()
    .showSuggestionAfterError();

  registerCommands(program);

  return program;
}

export async function runCli(
  argv: string[],
  options: RunCliOptions = {},
): Promise<RunCliResult> {
  const program = createProgram();
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? (() => undefined);
  const stderr = options.stderr ?? (() => undefined);

  program.configureOutput({
    writeErr: stderr,
    writeOut: stdout,
  });
  program.exitOverride();

  if (argv.length === 0) {
    program.outputHelp();

    return { exitCode: 0 };
  }

  try {
    attachCommandActions(program, { cwd, stderr, stdout });
    await program.parseAsync(['node', 'gji', ...argv], { from: 'node' });

    return { exitCode: 0 };
  } catch (error) {
    if (isCommanderExit(error)) {
      return { exitCode: error.exitCode };
    }

    throw error;
  }
}

function registerCommands(program: Command): void {
  program
    .command('new <branch>')
    .description('create a new branch and linked worktree')
    .action(notImplemented('new'));

  program
    .command('pr <number>')
    .description('fetch a pull request ref and create a linked worktree')
    .action(notImplemented('pr'));

  program
    .command('go [branch]')
    .description('print or select a worktree path')
    .action(notImplemented('go'));

  program
    .command('root')
    .description('print the main repository root path')
    .action(notImplemented('root'));

  program
    .command('ls')
    .description('list active worktrees')
    .action(notImplemented('ls'));

  program
    .command('clean')
    .description('interactively remove worktrees')
    .action(notImplemented('clean'));

  program
    .command('done [branch]')
    .description('remove a completed worktree and delete its branch')
    .action(notImplemented('done'));
}

function attachCommandActions(
  program: Command,
  options: Required<RunCliOptions>,
): void {
  program.commands
    .find((command) => command.name() === 'new')
    ?.action(async (branch: string) => {
      const exitCode = await runNewCommand({ ...options, branch });

      if (exitCode !== 0) {
        throw commanderExit(exitCode);
      }
    });

  program.commands
    .find((command) => command.name() === 'pr')
    ?.action(async (number: string) => {
      const exitCode = await runPrCommand({ cwd: options.cwd, number, stdout: options.stdout });

      if (exitCode !== 0) {
        throw commanderExit(exitCode);
      }
    });

  program.commands
    .find((command) => command.name() === 'go')
    ?.action(async (branch?: string) => {
      const exitCode = await runGoCommand({
        branch,
        cwd: options.cwd,
        stderr: options.stderr,
        stdout: options.stdout,
      });

      if (exitCode !== 0) {
        throw commanderExit(exitCode);
      }
    });

  program.commands
    .find((command) => command.name() === 'root')
    ?.action(async () => {
      const exitCode = await runRootCommand({
        cwd: options.cwd,
        stdout: options.stdout,
      });

      if (exitCode !== 0) {
        throw commanderExit(exitCode);
      }
    });

  program.commands
    .find((command) => command.name() === 'ls')
    ?.action(async () => {
      const exitCode = await runLsCommand({
        cwd: options.cwd,
        stdout: options.stdout,
      });

      if (exitCode !== 0) {
        throw commanderExit(exitCode);
      }
    });
}

function notImplemented(commandName: string): () => never {
  return () => {
    throw new Error(`'${commandName}' is not implemented yet.`);
  };
}

function commanderExit(exitCode: number): Error & { code: string; exitCode: number } {
  const error = new Error(`Command exited with code ${exitCode}.`) as Error & {
    code: string;
    exitCode: number;
  };

  error.code = 'commander.executeSubCommandAsync';
  error.exitCode = exitCode;

  return error;
}

function isCommanderExit(
  error: unknown,
): error is Error & { code: string; exitCode: number } {
  return (
    error instanceof Error &&
    'code' in error &&
    'exitCode' in error &&
    typeof error.code === 'string' &&
    typeof error.exitCode === 'number'
  );
}
