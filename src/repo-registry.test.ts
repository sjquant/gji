import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	loadRegistry,
	REGISTRY_FILE_PATH,
	registerRepo,
} from "./repo-registry.js";

const originalConfigDir = process.env.GJI_CONFIG_DIR;

afterEach(() => {
	if (originalConfigDir === undefined) {
		delete process.env.GJI_CONFIG_DIR;
	} else {
		process.env.GJI_CONFIG_DIR = originalConfigDir;
	}
});

async function makeConfigDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gji-config-"));
}

describe("REGISTRY_FILE_PATH", () => {
	it("uses GJI_CONFIG_DIR when set", async () => {
		// Given GJI_CONFIG_DIR points to a custom directory.
		const dir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = dir;

		// When REGISTRY_FILE_PATH is called.
		// Then it returns the path inside the custom directory.
		expect(REGISTRY_FILE_PATH()).toBe(join(dir, "repos.json"));
	});
});

describe("loadRegistry", () => {
	it("returns an empty array when the file does not exist", async () => {
		// Given a config directory with no registry file.
		const dir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = dir;

		// When loadRegistry is called.
		// Then it returns an empty array without throwing.
		expect(await loadRegistry()).toEqual([]);
	});

	it("returns an empty array when the file contains malformed JSON", async () => {
		// Given a registry file with corrupt contents.
		const dir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = dir;
		await writeFile(join(dir, "repos.json"), "not-json", "utf8");

		// When loadRegistry is called.
		// Then it returns an empty array without throwing.
		expect(await loadRegistry()).toEqual([]);
	});

	it("returns an empty array when the file contains a non-array", async () => {
		// Given a registry file that contains an object instead of an array.
		const dir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = dir;
		await writeFile(join(dir, "repos.json"), '{"key":"value"}', "utf8");

		// When loadRegistry is called.
		// Then it returns an empty array.
		expect(await loadRegistry()).toEqual([]);
	});

	it("filters out entries missing required fields", async () => {
		// Given a registry file with one valid entry and two incomplete entries.
		const dir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = dir;
		await writeFile(
			join(dir, "repos.json"),
			JSON.stringify([
				{ path: "/valid", name: "valid", lastUsed: 1000 },
				{ path: "/no-name", lastUsed: 1000 },
				{ name: "no-path", lastUsed: 1000 },
			]),
			"utf8",
		);

		// When loadRegistry is called.
		const registry = await loadRegistry();

		// Then only the complete entry is returned.
		expect(registry).toHaveLength(1);
		expect(registry[0].path).toBe("/valid");
	});

	it("preserves repeated repo entries when loading the registry", async () => {
		// Given a registry file that contains the same repo path twice.
		const dir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = dir;
		await writeFile(
			join(dir, "repos.json"),
			JSON.stringify([
				{ path: "/home/user/code/my-app", name: "my-app", lastUsed: 2000 },
				{ path: "/home/user/code/my-app", name: "my-app", lastUsed: 1000 },
			]),
			"utf8",
		);

		// When loadRegistry is called.
		const registry = await loadRegistry();

		// Then both entries are preserved for callers that need the raw registry.
		expect(registry).toEqual([
			{ path: "/home/user/code/my-app", name: "my-app", lastUsed: 2000 },
			{ path: "/home/user/code/my-app", name: "my-app", lastUsed: 1000 },
		]);
	});
});

describe("registerRepo", () => {
	it("creates an entry for a new repo", async () => {
		// Given an empty registry.
		const dir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = dir;

		// When a new repo is registered.
		await registerRepo("/home/user/code/my-app");
		const registry = await loadRegistry();

		// Then a single entry is created with the correct path, name, and timestamp.
		expect(registry).toHaveLength(1);
		expect(registry[0].path).toBe("/home/user/code/my-app");
		expect(registry[0].name).toBe("my-app");
		expect(typeof registry[0].lastUsed).toBe("number");
	});

	it("moves an existing entry to the front and updates lastUsed", async () => {
		// Given a registry with two repos, alpha registered first.
		const dir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = dir;
		await registerRepo("/home/user/code/alpha");
		await registerRepo("/home/user/code/beta");
		const beforeTimestamp = (await loadRegistry()).find(
			(e) => e.path === "/home/user/code/alpha",
		)!.lastUsed;

		// When alpha is registered again.
		await registerRepo("/home/user/code/alpha");
		const registry = await loadRegistry();

		// Then alpha moves to the front with an updated timestamp.
		expect(registry).toHaveLength(2);
		expect(registry[0].path).toBe("/home/user/code/alpha");
		expect(registry[0].lastUsed).toBeGreaterThanOrEqual(beforeTimestamp);
	});

	it("skips the write when the repo is already the most recent entry", async () => {
		// Given a registry with one entry.
		const dir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = dir;
		await registerRepo("/home/user/code/my-app");
		const { lastUsed: firstTimestamp } = (await loadRegistry())[0];

		// When the same repo is registered again immediately.
		await registerRepo("/home/user/code/my-app");
		const { lastUsed: secondTimestamp } = (await loadRegistry())[0];

		// Then the timestamp is unchanged (no-op write).
		expect(secondTimestamp).toBe(firstTimestamp);
	});

	it("prepends the newest repo so the list is most-recent-first", async () => {
		// Given three repos registered in order: alpha, beta, gamma.
		const dir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = dir;
		await registerRepo("/home/user/code/alpha");
		await registerRepo("/home/user/code/beta");
		await registerRepo("/home/user/code/gamma");

		// When the registry is loaded.
		const registry = await loadRegistry();

		// Then the entries are ordered most-recent-first.
		expect(registry.map((e) => e.name)).toEqual(["gamma", "beta", "alpha"]);
	});

	it("collapses alias paths for the same repo when registering again", async () => {
		// Given a real repo path and a symlink alias that points to it.
		const dir = await makeConfigDir();
		process.env.GJI_CONFIG_DIR = dir;
		const repoHome = await mkdtemp(join(tmpdir(), "gji-repo-paths-"));
		const realRepoPath = join(repoHome, "real-repo");
		const aliasRepoPath = join(repoHome, "alias-repo");
		await mkdir(realRepoPath, { recursive: true });
		await symlink(realRepoPath, aliasRepoPath);

		// When the alias path is registered first and the real path is registered later.
		await registerRepo(aliasRepoPath);
		await registerRepo(realRepoPath);
		const registry = await loadRegistry();
		const canonicalRepoPath = await realpath(realRepoPath);

		// Then the registry keeps only one canonical entry for that repo.
		expect(registry).toHaveLength(1);
		expect(registry[0].path).toBe(canonicalRepoPath);
		expect(registry[0].name).toBe("real-repo");
	});
});
