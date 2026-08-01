import { describe, expect, it } from "vitest";

import { createBootstrapReporter } from "./bootstrap-output.js";

describe("createBootstrapReporter", () => {
	it("describes a failed CoW seed as repair-only instead of a copy fallback", () => {
		// Given a human-readable reporter and a CoW seed failure event.
		const output: string[] = [];
		const reporter = createBootstrapReporter(
			(chunk) => output.push(chunk),
			false,
		);

		// When dependency bootstrap falls back to repairing an empty target.
		reporter.dependency({
			adapter: "yarn",
			kind: "dependency",
			reason: "cow-seed-failed",
			state: "fallback",
			target: "node_modules",
			message: "CoW seed failed; repairing from an empty target",
		});

		// Then the user-facing label cannot be mistaken for an ordinary copy.
		expect(output).toEqual([
			"gji: repair-only node_modules — CoW seed failed; repairing from an empty target\n",
		]);
	});
});
