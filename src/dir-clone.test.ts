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
	it("rejects a destination contained by its clone source", async () => {
		// Given a destination nested inside the directory being cloned.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-recursive-"));
		const source = join(root, "source");
		const destination = join(source, "nested", "clone");
		await mkdir(source);

		// When cloning would traverse its own lock or temporary output.
		const error = await cloneDir(source, destination, {
			platform: "linux",
		}).catch((caught) => caught);

		// Then cloning stops before creating anything below the source.
		expect(error).toHaveProperty(
			"message",
			expect.stringContaining("must not be inside"),
		);
		await expect(readdir(source)).resolves.toEqual([]);
	});

	it("stages a macOS CoW seed before publishing it", async () => {
		// Given a source directory and an observable forced-CoW boundary.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-macos-stage-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		await writeFile(join(source, "README.md"), "seed\n", "utf8");
		let stagingTarget = "";

		// When the macOS strategy creates its CoW seed.
		const result = await cloneDir(source, destination, {
			copyDirectory: async (_source, target) => {
				stagingTarget = target;
				await mkdir(target);
				await writeFile(join(target, "README.md"), "seed\n", "utf8");
			},
			copyFile: (sourcePath, destinationPath) =>
				copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL),
			measureBytes: false,
			platform: "darwin",
		});

		// Then publication uses a hidden staging directory and removes it afterward.
		expect(result.bytes).toBeUndefined();
		expect(stagingTarget).toContain(".destination.gji-clone-");
		await expect(
			readFile(join(destination, "README.md"), "utf8"),
		).resolves.toBe("seed\n");
		expect((await readdir(root)).sort()).toEqual(["destination", "source"]);
	});

	it("removes macOS staging when forced CoW is unavailable", async () => {
		// Given a macOS CoW operation that leaves partial staging output before failing.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-macos-reject-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);

		// When the filesystem rejects the forced CoW operation.
		const error = await cloneDir(source, destination, {
			copyDirectory: async (_source, target) => {
				await mkdir(target);
				await writeFile(join(target, "partial"), "partial\n", "utf8");
				const unsupported = new Error(
					"forced clone is unavailable",
				) as NodeJS.ErrnoException;
				unsupported.code = "ENOSYS";
				throw unsupported;
			},
			platform: "darwin",
		}).catch((caught) => caught);

		// Then no ordinary copy runs and neither staging nor the destination survives.
		expect(isCloneUnsupportedError(error)).toBe(true);
		await expect(readdir(root)).resolves.toEqual(["source"]);
	});

	it("keeps transient macOS I/O failures distinct from unsupported CoW", async () => {
		// Given a forced CoW operation that runs out of space temporarily.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-macos-enospc-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		const noSpace = new Error("disk is full") as NodeJS.ErrnoException;
		noSpace.code = "ENOSPC";

		// When the macOS CoW boundary reports the operational failure.
		const error = await cloneDir(source, destination, {
			copyDirectory: async () => {
				throw noSpace;
			},
			platform: "darwin",
		}).catch((caught) => caught);

		// Then callers can distinguish it from an unsupported filesystem and retry later.
		expect(error).toBe(noSpace);
		expect(isCloneUnsupportedError(error)).toBe(false);
		await expect(readdir(root)).resolves.toEqual(["source"]);
	});

	it("publishes a successful staged clone without temporary output", async () => {
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
			runLinuxCommand: async (_command, args) => {
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
				runLinuxCommand: async (_command, args) => {
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

	it("preserves files added concurrently while cleaning failed publication", async () => {
		// Given a staged clone whose destination gains an external nested file during publication.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-cleanup-race-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(join(source, "package"), { recursive: true });
		await writeFile(join(source, "package", "a.txt"), "a\n");
		await writeFile(join(source, "package", "b.txt"), "b\n");

		// When publication fails after another process writes below a directory created by gji.
		const error = await cloneDir(source, destination, {
			copyDirectory: async (_source, target) => {
				await mkdir(join(target, "package"), { recursive: true });
				await writeFile(join(target, "package", "a.txt"), "a\n");
				await writeFile(join(target, "package", "b.txt"), "b\n");
			},
			copyFile: async (sourcePath, destinationPath) => {
				if (sourcePath.endsWith("b.txt")) throw new Error("publication failed");
				await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
				await writeFile(join(destination, "package", "external.txt"), "keep\n");
			},
			platform: "darwin",
		}).catch((caught) => caught);

		// Then cleanup preserves the dirty subtree rather than deleting the concurrent file.
		expect(error).toHaveProperty("message", "publication failed");
		await expect(
			readFile(join(destination, "package", "external.txt"), "utf8"),
		).resolves.toBe("keep\n");
		await expect(
			readFile(join(destination, "package", "a.txt"), "utf8"),
		).resolves.toBe("a\n");
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
			runLinuxCommand: async (_command, args) => {
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
			runLinuxCommand: async (_command, args) => {
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
			runLinuxCommand: async () => {
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
			runLinuxCommand: async (_command, args) => mkdir(args.at(-1) as string),
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
			runLinuxCommand: async (_command, args) => {
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
			runLinuxCommand: async () => undefined,
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
		const lockPath = `${destination}.gji-clone-lock`;
		const token = "00000000-0000-0000-0000-000000000001";
		await mkdir(lockPath);
		await writeFile(join(lockPath, token), `${token}\n`);

		// When another clone attempts the same destination.
		const error = await cloneDir(source, destination, {
			platform: "linux",
		}).catch((caught) => caught);

		// Then the caller can report an active operation instead of pretending the destination exists.
		expect(isCloneInProgressError(error)).toBe(true);
		expect(isCloneDestinationExistsError(error)).toBe(false);
		await expect(readdir(root)).resolves.toContain("source");
	});

	it("keeps a concurrent clone from treating an in-progress reservation as reusable", async () => {
		// Given a clone paused after reserving its destination while holding the clone lock.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-contender-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		let releaseFirst: () => void = () => undefined;
		let markFirstStarted: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const firstStarted = new Promise<void>((resolve) => {
			markFirstStarted = resolve;
		});
		const first = cloneDir(source, destination, {
			copyDirectory: async (_source, target) => {
				markFirstStarted();
				await firstGate;
				await mkdir(target);
			},
			platform: "darwin",
		});
		await firstStarted;

		// When another clone attempts the same destination before publication finishes.
		const secondError = await cloneDir(source, destination, {
			platform: "darwin",
		}).catch((caught) => caught);
		releaseFirst();
		await first;

		// Then the contender reports active work and never treats partial state as a repair input.
		expect(isCloneInProgressError(secondError)).toBe(true);
		expect(isCloneDestinationExistsError(secondError)).toBe(false);
	});

	it("reclaims an abandoned clone lock without leaving the replacement lock behind", async () => {
		// Given an old lock for an absent destination.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-stale-lock-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		const lockPath = `${destination}.gji-clone-lock`;
		const token = "00000000-0000-0000-0000-000000000001";
		await mkdir(lockPath);
		const markerPath = join(lockPath, `owner-${token}`);
		await writeFile(markerPath, `${token}\n`);
		await utimes(markerPath, new Date(0), new Date(0));
		const abandonedGuard = `${lockPath}.guard`;
		await mkdir(abandonedGuard);
		await utimes(abandonedGuard, new Date(0), new Date(0));

		// When a new clone takes over the abandoned guard and legacy lock.
		await cloneDir(source, destination, {
			platform: "linux",
			runLinuxCommand: async (_command, args) => {
				await mkdir(args.at(-1) as string);
			},
		});

		// Then the clone succeeds and only its destination remains.
		await expect(readdir(root)).resolves.toEqual(["destination", "source"]);
	});

	it("reclaims an old empty lock left before its owner marker was written", async () => {
		// Given an empty clone lock directory left by an interrupted publisher.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-empty-lock-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		const lockPath = `${destination}.gji-clone-lock`;
		await mkdir(source);
		await mkdir(lockPath);
		const staleTime = new Date(Date.now() - 6 * 60 * 1000);
		await utimes(lockPath, staleTime, staleTime);

		// When a later clone encounters the abandoned pre-marker lock.
		await cloneDir(source, destination, {
			platform: "linux",
			runLinuxCommand: async (_command, args) => {
				await mkdir(args.at(-1) as string);
			},
		});

		// Then the stale lock is reclaimed and the clone completes normally.
		await expect(readdir(root)).resolves.toEqual(["destination", "source"]);
	});

	it("preserves a fresh empty lock while its owner may still write the marker", async () => {
		// Given an empty clone lock created within the stale timeout.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-fresh-lock-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		const lockPath = `${destination}.gji-clone-lock`;
		await mkdir(source);
		await mkdir(lockPath);

		// When another clone reaches the lock before its owner marker appears.
		const error = await cloneDir(source, destination, {
			platform: "linux",
		}).catch((caught) => caught);

		// Then the fresh lock remains protected as an in-progress operation.
		expect(isCloneInProgressError(error)).toBe(true);
		await expect(readdir(lockPath)).resolves.toEqual([]);
	});

	it("does not reclaim an unrelated directory that resembles a stale clone lock", async () => {
		// Given an old directory at the lock path without a valid owner marker.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-invalid-lock-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		const lockPath = `${destination}.gji-clone-lock`;
		await mkdir(source);
		await mkdir(lockPath);
		const userFile = join(lockPath, "keep.txt");
		await writeFile(userFile, "keep\n");
		await utimes(userFile, new Date(0), new Date(0));

		// When a clone encounters the lookalike path after the stale threshold.
		const error = await cloneDir(source, destination, {
			platform: "linux",
		}).catch((caught) => caught);

		// Then the path is treated as occupied and its unrelated contents survive.
		expect(isCloneInProgressError(error)).toBe(true);
		await expect(readFile(userFile, "utf8")).resolves.toBe("keep\n");
	});

	it("does not release a successor lock after its own stale lock is reclaimed", async () => {
		// Given a clone whose lock becomes stale while its clone command is suspended.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-lock-race-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		const lockPath = `${destination}.gji-clone-lock`;
		await mkdir(source);
		let releaseFirst: () => void = () => undefined;
		let releaseSecond: () => void = () => undefined;
		let markFirstStarted: () => void = () => undefined;
		let markSecondStarted: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const secondGate = new Promise<void>((resolve) => {
			releaseSecond = resolve;
		});
		const firstStarted = new Promise<void>((resolve) => {
			markFirstStarted = resolve;
		});
		const secondStarted = new Promise<void>((resolve) => {
			markSecondStarted = resolve;
		});
		const first = cloneDir(source, destination, {
			platform: "darwin",
			copyDirectory: async () => {
				markFirstStarted();
				await firstGate;
				throw new Error("first clone stopped");
			},
		}).catch((error) => error);
		await firstStarted;
		let firstMarker: string | undefined;
		while (!firstMarker) {
			await new Promise((resolve) => setTimeout(resolve, 1));
			[firstMarker] = await readdir(lockPath).catch(() => []);
		}
		await utimes(join(lockPath, firstMarker), new Date(0), new Date(0));
		await rm(destination, { force: true, recursive: true });
		const second = cloneDir(source, destination, {
			platform: "darwin",
			copyDirectory: async () => {
				markSecondStarted();
				await secondGate;
				throw new Error("second clone stopped");
			},
		}).catch((error) => error);
		await secondStarted;
		expect((await readdir(lockPath))[0]).not.toBe(firstMarker);

		// When the fenced-out first owner finishes and releases its old lock.
		releaseFirst();
		await first;

		// Then the second owner's marker still owns the lock.
		expect((await readdir(lockPath))[0]).not.toBe(firstMarker);
		releaseSecond();
		await second;
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
			runLinuxCommand: async (_command, args) => {
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
		const outcome = await cloneDir(source, destination, {
			destinationRoot: root,
		}).catch((caught) => caught);

		// Then unsupported filesystems fail cleanly, while supported ones publish the clone.
		if (outcome instanceof Error) {
			expect(isCloneUnsupportedError(outcome)).toBe(true);
			expect((await readdir(root)).sort()).toEqual(["source"]);
		} else {
			await expect(
				readFile(join(destination, "package.json"), "utf8"),
			).resolves.toBe("{}\n");
		}
	});
});
