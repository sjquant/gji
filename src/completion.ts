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
	const shell = options.shell
		? resolveSupportedShell(options.shell, undefined)
		: resolveSupportedShell(undefined, process.env.SHELL);

	if (!shell) {
		const message = options.shell
			? `Unsupported shell "${options.shell}". Supported shells: bash, fish, or zsh.`
			: "Unable to detect a supported shell. Specify one explicitly: bash, fish, or zsh.";
		options.stderr?.(`${message}\n`);
		return 1;
	}

	options.stdout(renderShellCompletion(shell));

	return 0;
}
