import { constants } from "node:fs";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	cloneDir,
	isCloneDestinationExistsError,
	isCloneInProgressError,
	isCloneUnsupportedError,
} from "./dir-clone.js";

describe("cloneDir", () => {
	it("atomically publishes a successful clone", async () => {
		// Given a source directory and a fake CoW command that creates its temporary output.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		await writeFile(join(source, "package.json"), "{}\n", "utf8");
		let cloneArgs: string[] = [];

		// When cloneDir runs the injected platform command.
		const result = await cloneDir(source, destination, {
			copyFile: (sourcePath, destinationPath) =>
				copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL),
			platform: "linux",
			runCommand: async (_command, args) => {
				cloneArgs = args;
				const temporaryDestination = args.at(-1) as string;
				await mkdir(temporaryDestination);
				await writeFile(
					join(temporaryDestination, "package.json"),
					"{}\n",
					"utf8",
				);
			},
		});

		// Then the final destination contains the clone and no temporary sibling remains.
		expect(result.bytes).toBeGreaterThan(0);
		expect(cloneArgs).toContain("--reflink=always");
		expect(result.ms).toBeGreaterThanOrEqual(0);
		await expect(
			readFile(join(destination, "package.json"), "utf8"),
		).resolves.toBe("{}\n");
		expect((await readdir(root)).sort()).toEqual(["destination", "source"]);
	});

	it("removes partial output after a clone command fails", async () => {
		// Given a source directory and a fake command that leaves partial temporary output.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		await writeFile(join(source, "package.json"), "{}\n", "utf8");

		// When the CoW command fails after writing one file.
		await expect(
			cloneDir(source, destination, {
				platform: "linux",
				runCommand: async (_command, args) => {
					const temporaryDestination = args.at(-1) as string;
					await mkdir(temporaryDestination);
					await writeFile(join(temporaryDestination, "partial"), "x", "utf8");
					throw new Error("reflink unsupported");
				},
			}),
		).rejects.toThrow("reflink unsupported");

		// Then neither the destination nor the temporary partial clone remains.
		expect((await readdir(root)).sort()).toEqual(["source"]);
	});

	it("reports the logical source size in bytes", async () => {
		// Given a source directory containing a file whose size is not a filesystem block multiple.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-size-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		await writeFile(join(source, "data.bin"), "x".repeat(2000), "utf8");

		// When cloneDir completes a successful copy-on-write clone.
		const result = await cloneDir(source, destination, {
			platform: "linux",
			runCommand: async (_command, args) => {
				await mkdir(args.at(-1) as string);
			},
		});

		// Then the reported size is the exact logical byte count, not filesystem blocks.
		expect(result.bytes).toBe(2000);
	});

	it("can omit the size traversal for machine-readable bootstrap", async () => {
		// Given a source directory with a measurable file.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-no-size-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		await writeFile(join(source, "data.bin"), "x".repeat(2000), "utf8");

		// When cloneDir is asked to skip optional size reporting.
		const result = await cloneDir(source, destination, {
			measureBytes: false,
			platform: "linux",
			runCommand: async (_command, args) => {
				await mkdir(args.at(-1) as string);
			},
		});

		// Then cloning succeeds without traversing the source for a byte estimate.
		expect(result.bytes).toBeUndefined();
	});

	it("does not invoke the copy command when the destination already exists", async () => {
		// Given an existing destination and a valid source directory.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		await mkdir(destination);
		let commandCalled = false;

		// When cloneDir is asked to clone over the destination.
		const error = await cloneDir(source, destination, {
			platform: "linux",
			runCommand: async () => {
				commandCalled = true;
			},
		}).catch((caught) => caught);

		// Then it reports the conflict without touching the existing directory.
		expect(isCloneDestinationExistsError(error)).toBe(true);
		expect(commandCalled).toBe(false);
	});

	it("does not publish over an existing empty destination", async () => {
		// Given an empty destination that exists before the clone starts.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-publish-race-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		await mkdir(destination);

		// When cloneDir attempts to publish the clone.
		const error = await cloneDir(source, destination, {
			platform: "linux",
			runCommand: async (_command, args) => mkdir(args.at(-1) as string),
		}).catch((caught) => caught);
		expect(isCloneDestinationExistsError(error)).toBe(true);

		// Then the existing destination remains empty and untouched.
		expect(await readdir(destination)).toEqual([]);
	});

	it("does not overwrite an entry created during clone publication", async () => {
		// Given a fake CoW clone whose destination entry appears during final publication.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-no-overwrite-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		await writeFile(join(source, "package.json"), "new\n", "utf8");

		// When publication races with a process that creates the same destination file.
		const error = await cloneDir(source, destination, {
			copyFile: async (sourcePath, destinationPath) => {
				await writeFile(destinationPath, "external\n", "utf8");
				await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
			},
			platform: "linux",
			runCommand: async (_command, args) => {
				const temporaryDestination = args.at(-1) as string;
				await mkdir(temporaryDestination);
				await writeFile(
					join(temporaryDestination, "package.json"),
					"new\n",
					"utf8",
				);
			},
		}).catch((caught) => caught);

		// Then the concurrent file is preserved and the clone reports a conflict.
		expect(isCloneDestinationExistsError(error)).toBe(true);
		await expect(
			readFile(join(destination, "package.json"), "utf8"),
		).resolves.toBe("external\n");
	});

	it("rejects a destination with a symbolic-link ancestor", async () => {
		// Given a source and a destination parent that points outside the worktree.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-link-"));
		const source = join(root, "source");
		const external = await mkdtemp(join(tmpdir(), "gji-dir-clone-external-"));
		const destinationParent = join(root, "worktree", "cache");
		const destination = join(destinationParent, "packages");
		await mkdir(source);
		await mkdir(join(root, "worktree"));
		await symlink(external, destinationParent);

		// When cloneDir is asked to create a nested destination.
		const error = await cloneDir(source, destination, {
			destinationRoot: join(root, "worktree"),
			platform: "linux",
			runCommand: async () => undefined,
		}).catch((caught) => caught);

		// Then it refuses to follow the link and leaves the external directory untouched.
		expect(error).toHaveProperty(
			"message",
			expect.stringContaining("symbolic-link"),
		);
		expect(await readdir(external)).toEqual([]);
	});

	it("skips unsupported filesystems without creating a destination", async () => {
		// Given a source directory on an unsupported platform.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);

		// When cloneDir is invoked.
		await expect(
			cloneDir(source, destination, { platform: "win32" }),
		).rejects.toThrow("not supported");

		// Then no destination is created.
		await expect(readdir(root)).resolves.toEqual(["source"]);
	});

	it("reports an active clone lock separately from a real destination conflict", async () => {
		// Given a fresh clone lock for an absent destination.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-lock-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		await mkdir(`${destination}.gji-clone-lock`);

		// When another clone attempts the same destination.
		const error = await cloneDir(source, destination, {
			platform: "linux",
		}).catch((caught) => caught);

		// Then the caller can report an active operation instead of pretending the destination exists.
		expect(isCloneInProgressError(error)).toBe(true);
		expect(isCloneDestinationExistsError(error)).toBe(false);
		await expect(readdir(root)).resolves.toContain("source");
	});

	it("reclaims an abandoned clone lock without leaving the replacement lock behind", async () => {
		// Given an old lock for an absent destination.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-stale-lock-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		const lockPath = `${destination}.gji-clone-lock`;
		await mkdir(lockPath);
		const ownerPath = join(lockPath, "owner-old-owner");
		await writeFile(ownerPath, "old-owner\n", "utf8");
		await utimes(ownerPath, new Date(0), new Date(0));

		// When a new clone takes over the abandoned lock.
		await cloneDir(source, destination, {
			platform: "linux",
			runCommand: async (_command, args) => {
				await mkdir(args.at(-1) as string);
			},
		});

		// Then the clone succeeds and only its destination remains.
		await expect(readdir(root)).resolves.toEqual(["destination", "source"]);
	});

	it("reports an unavailable size instead of a false zero", async () => {
		// Given a clone operation whose source disappears before optional measurement.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-size-error-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);

		// When cloning completes but size measurement cannot read the source.
		const result = await cloneDir(source, destination, {
			platform: "linux",
			runCommand: async (_command, args) => {
				await mkdir(args.at(-1) as string);
				await rm(source, { force: true, recursive: true });
			},
		});

		// Then the result distinguishes an unknown size from a zero-byte directory.
		expect(result.bytes).toBeUndefined();
	});

	it("never falls back to an ordinary copy on the default platform", async () => {
		// Given a source directory and a destination on the test filesystem.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-default-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		await writeFile(join(source, "package.json"), "{}\n", "utf8");

		// When cloneDir uses its production copy-on-write implementation.
		const error = await cloneDir(source, destination).catch((caught) => caught);

		// Then unsupported filesystems fail cleanly, while supported ones publish the clone.
		if (error) {
			expect(isCloneUnsupportedError(error)).toBe(true);
			expect((await readdir(root)).sort()).toEqual(["source"]);
		} else {
			await expect(
				readFile(join(destination, "package.json"), "utf8"),
			).resolves.toBe("{}\n");
		}
	});
});
