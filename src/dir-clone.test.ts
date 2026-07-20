import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	cloneDir,
	cloneStrategy,
	isCloneDestinationExistsError,
} from "./dir-clone.js";

describe("cloneStrategy", () => {
	it("selects the APFS clone command on macOS", () => {
		// Given the macOS platform.
		// When the CoW strategy is selected.
		const strategy = cloneStrategy("darwin");

		// Then it requests recursive clonefile copies.
		expect(strategy?.("source", "destination")).toEqual([
			"-Rc",
			"source",
			"destination",
		]);
	});

	it("selects mandatory reflinks on Linux", () => {
		// Given the Linux platform.
		// When the CoW strategy is selected.
		const strategy = cloneStrategy("linux");

		// Then it requires reflinks instead of allowing a normal copy.
		expect(strategy?.("source", "destination")).toEqual([
			"-a",
			"--reflink=always",
			"source",
			"destination",
		]);
	});

	it("rejects platforms without a CoW strategy", () => {
		// Given an unsupported platform.
		// When the CoW strategy is selected.
		const strategy = cloneStrategy("win32");

		// Then no ordinary-copy strategy is returned.
		expect(strategy).toBeNull();
	});
});

describe("cloneDir", () => {
	it("atomically publishes a successful clone", async () => {
		// Given a source directory and a fake CoW command that creates its temporary output.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		await writeFile(join(source, "package.json"), "{}\n", "utf8");

		// When cloneDir runs the injected platform command.
		const result = await cloneDir(source, destination, {
			platform: "linux",
			runCommand: async (_command, args) => {
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
		expect(result.bytes).toBe(3);
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
});
