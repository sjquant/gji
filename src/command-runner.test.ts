import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

	it("rejects a non-zero child and preserves its stderr", async () => {
		// Given a command that reports an error and exits unsuccessfully.
		const stderr: string[] = [];
		const command = `${JSON.stringify(process.execPath)} -e "process.stderr.write('failure'); process.exit(7)"`;

		// When the command runner executes it.
		const result = runCommand(command, process.cwd(), (chunk) =>
			stderr.push(chunk),
		);

		// Then the failure rejects instead of being mistaken for a successful repair.
		await expect(result).rejects.toThrow("exited with code 7");
		expect(stderr.join("")).toBe("failure");
	});

	it("rejects when the child process cannot start", async () => {
		// Given a command whose working directory does not exist.
		const root = await mkdtemp(join(tmpdir(), "gji-command-runner-"));
		const missingCwd = join(root, "missing");

		// When the command runner tries to start the child process.
		const result = runCommand("true", missingCwd, () => undefined);

		// Then the spawn error is surfaced to the caller.
		await expect(result).rejects.toMatchObject({ code: "ENOENT" });
	});
});
