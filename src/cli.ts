import { Command } from 'commander';

export interface RunCliOptions {
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
    .command('init')
    .description('initialize project config')
    .action(notImplemented('init'));

  program
    .command('new')
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

function notImplemented(commandName: string): () => never {
  return () => {
    throw new Error(`'${commandName}' is not implemented yet.`);
  };
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
