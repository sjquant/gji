import { SelectPrompt, isCancel as isCoreCancel } from '@clack/core';
import { isCancel, select } from '@clack/prompts';
import { listWorktrees, type WorktreeEntry } from './repo.js';

export interface GoCommandOptions {
  branch?: string;
  cwd: string;
  print?: boolean;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
}

export interface GoCommandDependencies {
  promptForCapturedOutputWorktree: (worktrees: WorktreeEntry[]) => Promise<string | null>;
  promptForWorktree: (worktrees: WorktreeEntry[]) => Promise<string | null>;
}

const GO_TTY_PROMPT_ENV = 'GJI_GO_TTY_PROMPT';
const GO_TTY_TARGET_PREFIX = '__GJI_TARGET__:';

export function createGoCommand(
  dependencies: Partial<GoCommandDependencies> = {},
): (options: GoCommandOptions) => Promise<number> {
  const promptForCapturedOutput =
    dependencies.promptForCapturedOutputWorktree ?? promptForCapturedOutputWorktree;
  const prompt = dependencies.promptForWorktree ?? promptForWorktree;

  return async function runGoCommand(options: GoCommandOptions): Promise<number> {
    const worktrees = await listWorktrees(options.cwd);

    if (options.branch) {
      const worktree = worktrees.find((entry) => entry.branch === options.branch);

      if (!worktree) {
        options.stderr(`No worktree found for branch: ${options.branch}\n`);
        return 1;
      }

      options.stdout(`${worktree.path}\n`);
      return 0;
    }

    const chosenPath = shouldUseCapturedOutputPrompt(options)
      ? await promptForCapturedOutput(worktrees)
      : await prompt(worktrees);

    if (!chosenPath) {
      options.stderr('Aborted\n');
      return 1;
    }

    const output = shouldUseCapturedOutputPrompt(options)
      ? `${GO_TTY_TARGET_PREFIX}${chosenPath}\n`
      : `${chosenPath}\n`;

    options.stdout(output);
    return 0;
  };
}

export const runGoCommand = createGoCommand();

async function promptForWorktree(
  worktrees: WorktreeEntry[],
): Promise<string | null> {
  const choice = await select<string>({
    message: 'Choose a worktree',
    options: worktrees.map((worktree) => ({
      value: worktree.path,
      label: worktree.branch ?? '(detached)',
      hint: worktree.path,
    })),
  });

  if (isCancel(choice)) {
    return null;
  }

  return choice;
}

async function promptForCapturedOutputWorktree(
  worktrees: WorktreeEntry[],
): Promise<string | null> {
  const options = worktrees.map((worktree) => ({
    value: worktree.path,
    label: worktree.branch ?? '(detached)',
    hint: worktree.path,
  }));

  const prompt = new SelectPrompt({
    input: process.stdin,
    options,
    output: process.stderr,
    render() {
      const lines = ['Choose a worktree'];

      switch (this.state) {
        case 'submit': {
          const selected = this.options[this.cursor];
          lines.push(`> ${selected.label} (${selected.hint})`);
          break;
        }
        case 'cancel':
          lines.push('> canceled');
          break;
        default:
          lines.push(
            ...this.options.map((option, index) => {
              const prefix = index === this.cursor ? '> ' : '  ';
              return `${prefix}${option.label} (${option.hint})`;
            }),
          );
          break;
      }

      return `${lines.join('\n')}\n`;
    },
  });
  const choice = await prompt.prompt();

  if (isCoreCancel(choice)) {
    return null;
  }

  return choice;
}

function shouldUseCapturedOutputPrompt(options: GoCommandOptions): boolean {
  return (
    !options.branch &&
    options.print === true &&
    process.env[GO_TTY_PROMPT_ENV] === '1'
  );
}
