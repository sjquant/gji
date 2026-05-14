import { resolveSupportedShell } from "./shell.js";
import { renderShellCompletion } from "./shell-completion.js";

export interface CompletionCommandOptions {
	shell?: string;
	stderr?: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export async function runCompletionCommand(
	options: CompletionCommandOptions,
): Promise<number> {
	const shell = resolveSupportedShell(options.shell, process.env.SHELL);

	if (!shell) {
		options.stderr?.(
			"Unable to detect a supported shell. Specify one explicitly: bash, fish, or zsh.\n",
		);
		return 1;
	}

	options.stdout(renderShellCompletion(shell));

	return 0;
}
