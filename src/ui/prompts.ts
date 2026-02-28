import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface PromptOption {
  value: string;
  label: string;
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export async function selectPrompt(message: string, options: PromptOption[]): Promise<string> {
  if (options.length === 0) {
    throw new Error("Select prompt requires at least one option.");
  }

  const rendered = [message, ...options.map((option, idx) => `${idx + 1}) ${option.label}`)].join("\n");

  let done = false;
  while (!done) {
    const answer = await ask(`${rendered}\nChoose an option [1-${options.length}]: `);
    const index = Number.parseInt(answer, 10) - 1;
    const option = options[index];
    if (option) {
      done = true;
      return option.value;
    }
    output.write("Please choose a valid option number.\n");
  }

  return options[0]!.value;
}

export async function multiSelectPrompt(
  message: string,
  options: PromptOption[],
): Promise<string[]> {
  if (options.length === 0) {
    return [];
  }

  const rendered = [message, ...options.map((option, idx) => `${idx + 1}) ${option.label}`)].join("\n");

  let done = false;
  while (!done) {
    const answer = await ask(
      `${rendered}\nChoose one or more options separated by commas (leave empty for none): `,
    );

    if (!answer) {
      return [];
    }

    const parsed = answer
      .split(",")
      .map((part) => Number.parseInt(part.trim(), 10) - 1)
      .filter((index) => Number.isInteger(index) && index >= 0 && index < options.length);

    if (parsed.length === 0) {
      output.write("Please choose at least one valid option number.\n");
      continue;
    }

    const uniqueIndices = [...new Set(parsed)];
    done = true;
    return uniqueIndices
      .map((index) => options[index])
      .filter((option): option is PromptOption => Boolean(option))
      .map((option) => option.value);
  }

  return [];
}

export async function confirmPrompt(message: string, defaultValue = false): Promise<boolean> {
  const defaultHint = defaultValue ? "Y/n" : "y/N";

  let done = false;
  while (!done) {
    const answer = (await ask(`${message} [${defaultHint}]: `)).toLowerCase();

    if (!answer) {
      done = true;
      return defaultValue;
    }

    if (answer === "y" || answer === "yes") {
      done = true;
      return true;
    }

    if (answer === "n" || answer === "no") {
      done = true;
      return false;
    }

    output.write("Please answer yes or no.\n");
  }

  return defaultValue;
}
