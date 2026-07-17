import { describe, expect, it } from "vitest";

import { createBrowserOpener } from "./browser.js";

describe("browser opener", () => {
	it.each([
		["darwin", "open", ["https://example.com/pr/1"]],
		["linux", "xdg-open", ["https://example.com/pr/1"]],
		["win32", "cmd.exe", ["/c", "start", "", "https://example.com/pr/1"]],
	] as const)("uses the default opener on %s", async (os, command, args) => {
		// Given an OS-specific browser opener with a command boundary spy.
		const calls: { args: string[]; command: string }[] = [];
		const open = createBrowserOpener({
			platform: os,
			runCommand: async (actualCommand, actualArgs) => {
				calls.push({ args: actualArgs, command: actualCommand });
			},
		});

		// When a PR URL is opened.
		await open("https://example.com/pr/1");

		// Then the OS default browser command receives the URL without shell parsing.
		expect(calls).toEqual([{ args, command }]);
	});

	it("propagates browser command failures", async () => {
		// Given a browser command boundary that fails.
		const open = createBrowserOpener({
			platform: "linux",
			runCommand: async () => {
				throw new Error("xdg-open unavailable");
			},
		});

		// When the browser opener is invoked.
		// Then the caller receives the original boundary error.
		await expect(open("https://example.com/pr/1")).rejects.toThrow(
			"xdg-open unavailable",
		);
	});
});
