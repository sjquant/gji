import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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

	it("does not reuse expired failures", async () => {
		// Given an isolated state file containing a failure older than the cache TTL.
		const root = await mkdtemp(join(tmpdir(), "gji-state-expired-"));
		process.env.GJI_CONFIG_DIR = root;
		await writeFile(
			join(root, "state.json"),
			JSON.stringify({
				syncDirs: {
					"/repo": {
						node_modules: {
							failedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
							reason: "unsupported",
						},
					},
				},
			}),
			"utf8",
		);
		const store = new FileCloneFailureStore();

		// When the expired entry is queried.
		const cached = await store.isCached("/repo", "node_modules");

		// Then the expired failure no longer suppresses a clone attempt.
		expect(cached).toBe(false);
	});

	it("treats malformed state as an empty cache", async () => {
		// Given an isolated state file containing invalid JSON.
		const root = await mkdtemp(join(tmpdir(), "gji-state-malformed-"));
		process.env.GJI_CONFIG_DIR = root;
		await writeFile(join(root, "state.json"), "not-json", "utf8");
		const store = new FileCloneFailureStore();

		// When the malformed cache is queried.
		const cached = await store.isCached("/repo", "node_modules");

		// Then cache corruption remains advisory and does not block setup.
		expect(cached).toBe(false);
	});

	it("preserves concurrent updates from separate store instances", async () => {
		// Given two store instances sharing one state directory.
		const root = await mkdtemp(join(tmpdir(), "gji-state-concurrent-"));
		process.env.GJI_CONFIG_DIR = root;
		const first = new FileCloneFailureStore();
		const second = new FileCloneFailureStore();

		// When both processes update different failure entries concurrently.
		await Promise.all([
			first.cache("/repo", "node_modules", "unsupported"),
			second.cache("/repo", ".venv", "unsupported"),
		]);

		// Then neither update is lost.
		await expect(first.isCached("/repo", "node_modules")).resolves.toBe(true);
		await expect(first.isCached("/repo", ".venv")).resolves.toBe(true);
	});
});
