import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createProgram } from "./cli.js";
import { renderShellCompletion } from "./shell-completion.js";

describe("CLI documentation parity", () => {
	it("keeps registered top-level commands discoverable in both command references", async () => {
		// Given the commands registered by the CLI and the checked-in references.
		const program = createProgram();
		const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
		const website = await readFile(
			join(process.cwd(), "website/docs/commands.mdx"),
			"utf8",
		);

		// When each command is matched against its canonical name or compatibility alias.
		const documented = program.commands.map((command) => {
			const names = [command.name(), ...command.aliases()];
			return {
				name: command.name(),
				readme: names.some((name) => readme.includes(`gji ${name}`)),
				website: names.some((name) => website.includes(`gji ${name}`)),
			};
		});

		// Then every registered command appears in both references.
		expect(documented.filter((entry) => !entry.readme)).toEqual([]);
		expect(documented.filter((entry) => !entry.website)).toEqual([]);
	});

	it("keeps lifecycle options discoverable in references and completions", async () => {
		// Given the registered lifecycle options and checked-in command references.
		const program = createProgram();
		const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
		const website = await readFile(
			join(process.cwd(), "website/docs/commands.mdx"),
			"utf8",
		);
		const references = `${readme}\n${website}`;
		const lifecycle = ["new", "done", "undo"].flatMap((name) => {
			const command = program.commands.find(
				(candidate) => candidate.name() === name,
			);
			return (
				command?.options
					.map((option) => option.long ?? option.short)
					.filter((option): option is string => option !== undefined) ?? []
			);
		});
		const completions = ["bash", "fish", "zsh"].map((shell) => ({
			shell,
			text: renderShellCompletion(shell as "bash" | "fish" | "zsh"),
		}));

		// When every registered lifecycle option is checked against the public surfaces.
		const missing = lifecycle.filter(
			(option) =>
				!references.includes(option) ||
				!completions.every(({ shell, text }) =>
					shell === "fish"
						? text.includes(`-l ${option.slice(2)}`)
						: text.includes(option),
				),
		);

		// Then no lifecycle option silently drifts out of documentation or completion.
		expect(missing).toEqual([]);
	});

	it("keeps remove deprecation guidance aligned across surfaces", async () => {
		// Given the deprecated remove command and its public references.
		const command = createProgram().commands.find(
			(candidate) => candidate.name() === "remove",
		);
		const readme = await readFile(join(process.cwd(), "README.md"), "utf8");
		const website = await readFile(
			join(process.cwd(), "website/docs/commands.mdx"),
			"utf8",
		);
		const zsh = renderShellCompletion("zsh");

		// When deprecation wording is compared with help, docs, and completion.
		// Then every public surface points users to the replacement lifecycle commands.
		expect(command?.description()).toContain("deprecated");
		expect(readme).toContain("Use `gji done <branch>`");
		expect(readme).toContain("`gji clean` to prune");
		expect(website).toContain("`gji done <branch>` to finish");
		expect(website).toContain("`gji clean` for bulk cleanup");
		expect(zsh).toContain(
			"deprecated: use done for one worktree or clean for bulk cleanup",
		);
	});
});
