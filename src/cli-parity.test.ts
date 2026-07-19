import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createProgram } from "./cli.js";

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
});
