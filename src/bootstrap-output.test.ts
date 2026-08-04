import { describe, expect, it } from "vitest";

import { createBootstrapReporter } from "./bootstrap-output.js";

describe("createBootstrapReporter", () => {
	it("describes a dependency install failure in human-readable output", () => {
		// Given a human-readable reporter and a dependency install failure event.
		const output: string[] = [];
		const reporter = createBootstrapReporter(
			(chunk) => output.push(chunk),
			false,
		);

		// When dependency bootstrap reports the failed install.
		reporter.dependency({
			adapter: "yarn",
			kind: "dependency",
			reason: "install-failed",
			state: "failed",
			target: "node_modules",
			message: "install failed: network unavailable",
		});

		// Then the user-facing label cannot be mistaken for an ordinary copy.
		expect(output).toEqual([
			"gji: failed node_modules — install failed: network unavailable\n",
		]);
	});
});
