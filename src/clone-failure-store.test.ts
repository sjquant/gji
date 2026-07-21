import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileCloneFailureStore } from "./clone-failure-store.js";

const originalConfigDir = process.env.GJI_CONFIG_DIR;

afterEach(() => {
	if (originalConfigDir === undefined) delete process.env.GJI_CONFIG_DIR;
	else process.env.GJI_CONFIG_DIR = originalConfigDir;
});

describe("FileCloneFailureStore", () => {
	it("caches only explicitly failed directory names", async () => {
		// Given an isolated state directory with one ordinary cached failure.
		const root = await mkdtemp(join(tmpdir(), "gji-state-"));
		process.env.GJI_CONFIG_DIR = root;
		const store = new FileCloneFailureStore();
		await store.cache("/repo", "node_modules", "unsupported");

		// When cache lookups use an inherited object-property name and the cached name.
		const inheritedNameCached = await store.isCached("/repo", "constructor");
		const ordinaryNameCached = await store.isCached("/repo", "node_modules");

		// Then only the explicitly cached directory is suppressed.
		expect(inheritedNameCached).toBe(false);
		expect(ordinaryNameCached).toBe(true);
		await store.clear("/repo", "node_modules");
		await expect(readFile(join(root, "state.json"), "utf8")).resolves.toContain(
			"syncDirs",
		);
	});

	it("keeps scoped dependency failures separate", async () => {
		// Given an isolated state directory with one scoped CoW failure.
		const root = await mkdtemp(join(tmpdir(), "gji-state-scoped-"));
		process.env.GJI_CONFIG_DIR = root;
		const store = new FileCloneFailureStore();
		await store.cache("/repo", "node_modules", "unsupported", "dependency-a");

		// When two bootstrap scopes query the same logical directory.
		const sameScope = await store.isCached(
			"/repo",
			"node_modules",
			"dependency-a",
		);
		const differentScope = await store.isCached(
			"/repo",
			"node_modules",
			"dependency-b",
		);

		// Then a failure from one source/filesystem scope does not suppress another.
		expect(sameScope).toBe(true);
		expect(differentScope).toBe(false);
	});
});
