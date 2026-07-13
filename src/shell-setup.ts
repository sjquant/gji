import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

import type { SupportedShell } from "./shell.js";

export async function executableExists(command: string): Promise<boolean> {
	const candidates = command.includes("/")
		? [command]
		: (process.env.PATH ?? "")
				.split(delimiter)
				.filter(Boolean)
				.map((directory) => join(directory, command));

	for (const path of candidates) {
		try {
			await access(path, constants.X_OK);
			return true;
		} catch {
			// Continue until a matching executable is found.
		}
	}

	return false;
}

export function resolveShellConfigPath(
	shell: SupportedShell,
	home: string,
): string {
	switch (shell) {
		case "bash":
			return join(home, ".bashrc");
		case "fish":
			return join(home, ".config", "fish", "config.fish");
		case "zsh":
			return join(home, ".zshrc");
	}
}

export function resolveCompletionPath(
	shell: SupportedShell,
	home: string,
): string {
	switch (shell) {
		case "bash":
			return join(
				home,
				".local",
				"share",
				"bash-completion",
				"completions",
				"gji",
			);
		case "fish":
			return join(home, ".config", "fish", "completions", "gji.fish");
		case "zsh":
			return join(home, ".zsh", "completions", "_gji");
	}
}
