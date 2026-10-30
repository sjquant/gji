import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		setupFiles: ["./vitest.setup.ts"],
		// Most tests run real Git commands, so CPU contention can slow them down.
		testTimeout: 15_000,
	},
});
