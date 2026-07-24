import {
	mkdir,
	mkdtemp,
	readFile,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { syncFiles } from "./file-sync.js";

async function makeTmpDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gji-file-sync-"));
}

describe("syncFiles", () => {
	it("copies a file from mainRoot to targetPath", async () => {
		// Given
		const mainRoot = await makeTmpDir();
		const targetPath = await makeTmpDir();
		await writeFile(join(mainRoot, "foo.txt"), "hello", "utf8");

		// When
		await syncFiles(mainRoot, targetPath, ["foo.txt"]);

		// Then
		const content = await readFile(join(targetPath, "foo.txt"), "utf8");
		expect(content).toBe("hello");
	});

	it("skips silently when the source does not exist", async () => {
		// Given
		const mainRoot = await makeTmpDir();
		const targetPath = await makeTmpDir();

		// When
		await syncFiles(mainRoot, targetPath, ["missing.txt"]);

		// Then — no target file was created
		await expect(stat(join(targetPath, "missing.txt"))).rejects.toThrow();
	});

	it("skips silently when the target already exists", async () => {
		// Given
		const mainRoot = await makeTmpDir();
		const targetPath = await makeTmpDir();
		await writeFile(join(mainRoot, "foo.txt"), "new content", "utf8");
		await writeFile(join(targetPath, "foo.txt"), "original content", "utf8");

		// When
		await syncFiles(mainRoot, targetPath, ["foo.txt"]);

		// Then — existing file is untouched
		const content = await readFile(join(targetPath, "foo.txt"), "utf8");
		expect(content).toBe("original content");
	});

	it("copies a file into a nested path, creating parent directories", async () => {
		// Given
		const mainRoot = await makeTmpDir();
		const targetPath = await makeTmpDir();
		const { mkdir } = await import("node:fs/promises");
		await mkdir(join(mainRoot, "a/b"), { recursive: true });
		await writeFile(join(mainRoot, "a/b/config.json"), "{}", "utf8");

		// When
		await syncFiles(mainRoot, targetPath, ["a/b/config.json"]);

		// Then
		const content = await readFile(join(targetPath, "a/b/config.json"), "utf8");
		expect(content).toBe("{}");
	});

	it("rejects an absolute-path pattern", async () => {
		// Given
		const mainRoot = await makeTmpDir();
		const targetPath = await makeTmpDir();

		// When / Then
		await expect(
			syncFiles(mainRoot, targetPath, ["/etc/passwd"]),
		).rejects.toThrow("pattern must be a relative path");
	});

	it('rejects a pattern containing ".." segments', async () => {
		// Given
		const mainRoot = await makeTmpDir();
		const targetPath = await makeTmpDir();

		// When / Then
		await expect(
			syncFiles(mainRoot, targetPath, ["../secret.txt"]),
		).rejects.toThrow("pattern must not contain '..' segments");
	});

	it("copies a gitignored file that exists only in the main worktree", async () => {
		// Given — a .gitignore that excludes .env, and a .env file present at the source.
		// This is the primary use case: syncing secrets/credentials that git won't carry
		// into a fresh worktree.
		const mainRoot = await makeTmpDir();
		const targetPath = await makeTmpDir();
		await writeFile(join(mainRoot, ".gitignore"), ".env\n", "utf8");
		await writeFile(join(mainRoot, ".env"), "SECRET=abc\n", "utf8");

		// When
		await syncFiles(mainRoot, targetPath, [".env"]);

		// Then — the ignored file is copied regardless of .gitignore
		const content = await readFile(join(targetPath, ".env"), "utf8");
		expect(content).toBe("SECRET=abc\n");
	});

	it("rejects a source symlink that escapes the main worktree", async () => {
		// Given a configured source file whose symlink points outside the repository.
		const mainRoot = await makeTmpDir();
		const targetPath = await makeTmpDir();
		const externalPath = await makeTmpDir();
		await writeFile(join(externalPath, "secret.env"), "SECRET=external\n");
		await symlink(
			join(externalPath, "secret.env"),
			join(mainRoot, ".env.local"),
		);

		// When syncFiles evaluates the source.
		const result = syncFiles(mainRoot, targetPath, [".env.local"]);

		// Then it refuses to copy external content into the new worktree.
		await expect(result).rejects.toThrow("resolves outside the repository");
		await expect(stat(join(targetPath, ".env.local"))).rejects.toThrow();
	});

	it("rejects a symlinked destination parent", async () => {
		// Given a source file and a destination parent that points outside the worktree.
		const mainRoot = await makeTmpDir();
		const targetPath = await makeTmpDir();
		const outsidePath = await makeTmpDir();
		await mkdir(join(mainRoot, "nested"), { recursive: true });
		await writeFile(join(mainRoot, "nested/config.json"), "{}", "utf8");
		await symlink(outsidePath, join(targetPath, "nested"));

		// When syncFiles processes the nested file.
		const result = syncFiles(mainRoot, targetPath, ["nested/config.json"]);

		// Then it refuses to write through the symlink.
		await expect(result).rejects.toThrow("symbolic-link component");
		await expect(stat(join(outsidePath, "config.json"))).rejects.toThrow();
	});

	it("rejects a dangling symlink at the destination file", async () => {
		// Given a source file and a dangling destination symlink pointing outside the worktree.
		const mainRoot = await makeTmpDir();
		const targetPath = await makeTmpDir();
		const outsidePath = await makeTmpDir();
		await writeFile(join(mainRoot, "config.json"), "{}", "utf8");
		await symlink(
			join(outsidePath, "missing.json"),
			join(targetPath, "config.json"),
		);

		// When syncFiles processes the destination.
		const result = syncFiles(mainRoot, targetPath, ["config.json"]);

		// Then it refuses to follow the dangling symlink.
		await expect(result).rejects.toThrow("symbolic link");
		await expect(stat(join(outsidePath, "missing.json"))).rejects.toThrow();
	});

	it("handles an empty patterns array without error", async () => {
		// Given
		const mainRoot = await makeTmpDir();
		const targetPath = await makeTmpDir();

		// When / Then
		await expect(syncFiles(mainRoot, targetPath, [])).resolves.toBeUndefined();
	});
});
