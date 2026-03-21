import { Command } from 'commander';

import { runConfigCommand } from './config-command.js';
import { runGoCommand } from './go.js';
import { runInitCommand } from './init.js';
import { runLsCommand } from './ls.js';
import { runNewCommand } from './new.js';
import { runPrCommand } from './pr.js';
import { runRemoveCommand } from './remove.js';
import { runRootCommand } from './root.js';
import { runStatusCommand } from './status.js';
import { runSyncCommand } from './sync.js';

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
    .command('init [shell]')
    .description('print or install shell integration')
    .option('--write', 'write the integration to the shell config file')
    .action(notImplemented('init'));

  program
    .command('pr <number>')
    .description('fetch a pull request ref and create a linked worktree')
    .action(notImplemented('pr'));

  program
    .command('go [branch]')
    .description('print or select a worktree path')
    .option('--print', 'print the resolved worktree path explicitly')
    .action(notImplemented('go'));

  program
    .command('root')
    .description('print the main repository root path')
    .action(notImplemented('root'));

  program
    .command('status')
    .description('summarize repository and worktree health')
    .option('--json', 'print repository and worktree health as JSON')
    .action(notImplemented('status'));

  program
    .command('sync')
    .description('fetch and update one or all worktrees')
    .option('--all', 'sync every worktree in the repository')
    .action(notImplemented('sync'));

  program
    .command('ls')
    .description('list active worktrees')
    .option('--json', 'print active worktrees as JSON')
    .action(notImplemented('ls'));

  program
    .command('remove [branch]')
    .description('remove a linked worktree and delete its branch when present')
    .action(notImplemented('remove'));

  const configCommand = program
    .command('config')
    .description('manage global config defaults')
    .action(notImplemented('config'));

  configCommand
    .command('get [key]')
    .description('print the global config or a single key')
    .action(notImplemented('config get'));

  configCommand
    .command('set <key> <value>')
    .description('set a global config value')
    .action(notImplemented('config set'));

  configCommand
    .command('unset <key>')
    .description('remove a global config value')
    .action(notImplemented('config unset'));
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
    .find((command) => command.name() === 'init')
    ?.action(async (shell: string | undefined, commandOptions: { write?: boolean }) => {
      const exitCode = await runInitCommand({
        cwd: options.cwd,
        shell,
        stdout: options.stdout,
        write: commandOptions.write,
      });

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
    ?.action(async (branch: string | undefined, commandOptions: { print?: boolean }) => {
      const exitCode = await runGoCommand({
        branch,
        cwd: options.cwd,
        print: commandOptions.print,
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
    .find((command) => command.name() === 'status')
    ?.action(async (commandOptions: { json?: boolean }) => {
      const exitCode = await runStatusCommand({
        cwd: options.cwd,
        json: commandOptions.json,
        stdout: options.stdout,
      });

      if (exitCode !== 0) {
        throw commanderExit(exitCode);
      }
    });

  program.commands
    .find((command) => command.name() === 'sync')
    ?.action(async (commandOptions: { all?: boolean }) => {
      const exitCode = await runSyncCommand({
        all: commandOptions.all,
        cwd: options.cwd,
        stderr: options.stderr,
        stdout: options.stdout,
      });

      if (exitCode !== 0) {
        throw commanderExit(exitCode);
      }
    });

  program.commands
    .find((command) => command.name() === 'ls')
    ?.action(async (commandOptions: { json?: boolean }) => {
      const exitCode = await runLsCommand({
        cwd: options.cwd,
        json: commandOptions.json,
        stdout: options.stdout,
      });

      if (exitCode !== 0) {
        throw commanderExit(exitCode);
      }
    });

  const runRemovalCommand = async (branch?: string) => {
    const exitCode = await runRemoveCommand({
      branch,
      cwd: options.cwd,
      stderr: options.stderr,
      stdout: options.stdout,
    });

    if (exitCode !== 0) {
      throw commanderExit(exitCode);
    }
  };

  program.commands
    .find((command) => command.name() === 'remove')
    ?.action(runRemovalCommand);

  const configCommand = program.commands.find((command) => command.name() === 'config');

  configCommand?.action(async () => {
    const exitCode = await runConfigCommand({
      cwd: options.cwd,
      stdout: options.stdout,
    });

    if (exitCode !== 0) {
      throw commanderExit(exitCode);
    }
  });

  configCommand?.commands.find((command) => command.name() === 'get')?.action(async (key?: string) => {
    const exitCode = await runConfigCommand({
      action: 'get',
      cwd: options.cwd,
      key,
      stdout: options.stdout,
    });

    if (exitCode !== 0) {
      throw commanderExit(exitCode);
    }
  });

  configCommand?.commands
    .find((command) => command.name() === 'set')
    ?.action(async (key: string, value: string) => {
      const exitCode = await runConfigCommand({
        action: 'set',
        cwd: options.cwd,
        key,
        stdout: options.stdout,
        value,
      });

      if (exitCode !== 0) {
        throw commanderExit(exitCode);
      }
    });

  configCommand?.commands.find((command) => command.name() === 'unset')?.action(async (key: string) => {
    const exitCode = await runConfigCommand({
      action: 'unset',
      cwd: options.cwd,
      key,
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
