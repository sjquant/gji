import { describe, expect, it } from "vitest";

import { runCommand } from "./command-runner.js";

describe("runCommand", () => {
	it("routes child stdout through the caller-provided stream", async () => {
		// Given a command that writes output to stdout and stderr.
		const stdout: string[] = [];
		const stderr: string[] = [];
		const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write('out'); process.stderr.write('err')"`;

		// When the command runner executes it.
		await runCommand(
			command,
			process.cwd(),
			(chunk) => stderr.push(chunk),
			(chunk) => stdout.push(chunk),
		);

		// Then each stream remains independently controllable for JSON callers.
		expect(stdout.join("")).toBe("out");
		expect(stderr.join("")).toBe("err");
	});
});
