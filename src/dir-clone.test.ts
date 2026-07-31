import { execFile } from "node:child_process";
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
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
	CloneUnsupportedError,
	cloneDir,
	isCloneDestinationExistsError,
	isCloneInProgressError,
	isCloneUnsupportedError,
} from "./dir-clone.js";

const execFileAsync = promisify(execFile);

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

	it("publishes a macOS clone atomically without a staging copy", async () => {
		// Given a source directory and an observable native clone boundary.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-macos-command-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		await writeFile(join(source, "README.md"), "seed\n", "utf8");
		let cloneTarget = "";

		// When gji performs the macOS clone through its native clone boundary.
		const result = await cloneDir(source, destination, {
			atomicCloneDirectory: async (_source, target) => {
				cloneTarget = target;
				await mkdir(target);
				await writeFile(join(target, "README.md"), "seed\n", "utf8");
			},
			measureBytes: false,
			platform: "darwin",
		});

		// Then the clone syscall targets the final path and no temporary sibling remains.
		expect(result.bytes).toBeUndefined();
		expect(cloneTarget).toMatch(/[/\\]destination$/u);
		expect((await readdir(root)).sort()).toEqual(["destination", "source"]);
	});

	it("leaves no destination when native macOS cloning is unsupported", async () => {
		// Given a source on a filesystem that rejects native CoW cloning.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-macos-reject-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);

		// When the atomic native clone reports that CoW is unsupported.
		const error = await cloneDir(source, destination, {
			atomicCloneDirectory: async () => {
				throw new CloneUnsupportedError("APFS clone is unavailable");
			},
			platform: "darwin",
		}).catch((caught) => caught);

		// Then no fallback copy runs and no destination survives.
		expect(isCloneUnsupportedError(error)).toBe(true);
		expect(error).toHaveProperty(
			"message",
			expect.stringContaining("APFS clone"),
		);
		await expect(readdir(root)).resolves.toEqual(["source"]);
	});

	it("preserves a destination won by another process during macOS cloning", async () => {
		// Given another process that atomically creates the destination first.
		const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-macos-race-"));
		const source = join(root, "source");
		const destination = join(root, "destination");
		await mkdir(source);
		await writeFile(join(source, "README.md"), "seed\n", "utf8");

		// When native clonefile rejects its destination-exists precondition.
		const error = await cloneDir(source, destination, {
			atomicCloneDirectory: async () => {
				await mkdir(destination);
				await writeFile(join(destination, "README.md"), "external\n");
				const conflict = new Error(
					"destination exists",
				) as NodeJS.ErrnoException;
				conflict.code = "EEXIST";
				throw conflict;
			},
			platform: "darwin",
		}).catch((caught) => caught);

		// Then clone publication fails without replacing or deleting the winner.
		expect(isCloneDestinationExistsError(error)).toBe(true);
		await expect(
			readFile(join(destination, "README.md"), "utf8"),
		).resolves.toBe("external\n");
	});

	it.skipIf(process.platform !== "darwin")(
		"uses the macOS clone command for a real directory seed",
		async () => {
			// Given a directory on the local macOS filesystem.
			const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-macos-"));
			const source = join(root, "source");
			const destination = join(root, "worktree", "destination");
			await mkdir(source);
			await writeFile(join(source, "README.md"), "seed\n", "utf8");

			// When gji performs a native macOS CoW clone.
			const result = await cloneDir(source, destination, {
				destinationRoot: root,
				measureBytes: false,
				platform: "darwin",
			});

			// Then the seed is published and readable in the destination.
			expect(result.bytes).toBeUndefined();
			await expect(
				readFile(join(destination, "README.md"), "utf8"),
			).resolves.toBe("seed\n");
		},
	);

	it.skipIf(process.platform !== "darwin")(
		"preserves macOS directory metadata in a CoW seed",
		async () => {
			// Given an APFS source directory with an extended attribute.
			const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-macos-xattr-"));
			const source = join(root, "source");
			const nested = join(source, "nested");
			const destination = join(root, "destination");
			await mkdir(nested, { recursive: true });
			await execFileAsync("/usr/bin/xattr", [
				"-w",
				"com.gji.clone-test",
				"preserved",
				nested,
			]);

			// When the native helper clones the tree.
			await cloneDir(source, destination, {
				measureBytes: false,
				platform: "darwin",
			});

			// Then directory metadata survives alongside cloned file data.
			const { stdout } = await execFileAsync("/usr/bin/xattr", [
				"-p",
				"com.gji.clone-test",
				join(destination, "nested"),
			]);
			expect(stdout.trim()).toBe("preserved");
		},
	);

	it.skipIf(process.platform !== "darwin")(
		"publishes a native macOS clone whose root ACL denies deletion",
		async () => {
			// Given a source root whose copied ACL would prevent renaming a staging directory.
			const root = await mkdtemp(join(tmpdir(), "gji-dir-clone-macos-acl-"));
			const source = join(root, "source");
			const destination = join(root, "destination");
			await mkdir(source);
			await writeFile(join(source, "README.md"), "seed\n", "utf8");
			await execFileAsync("/bin/chmod", ["+a", "everyone deny delete", source]);

			// When the directory is cloned and published atomically.
			await cloneDir(source, destination, {
				measureBytes: false,
				platform: "darwin",
			});

			// Then publication succeeds before the restrictive root ACL is restored.
			await expect(
				readFile(join(destination, "README.md"), "utf8"),
			).resolves.toBe("seed\n");
			const { stdout } = await execFileAsync("/bin/ls", ["-lde", destination]);
			expect(stdout).toContain("everyone deny delete");
		},
	);

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
		let markSecondStarted: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const secondGate = new Promise<void>((resolve) => {
			releaseSecond = resolve;
		});
		const secondStarted = new Promise<void>((resolve) => {
			markSecondStarted = resolve;
		});
		const first = cloneDir(source, destination, {
			platform: "darwin",
			atomicCloneDirectory: async () => {
				await firstGate;
				throw new Error("first clone stopped");
			},
		}).catch((error) => error);
		let firstMarker: string | undefined;
		while (!firstMarker) {
			await new Promise((resolve) => setTimeout(resolve, 1));
			[firstMarker] = await readdir(lockPath).catch(() => []);
		}
		await utimes(join(lockPath, firstMarker), new Date(0), new Date(0));
		const second = cloneDir(source, destination, {
			platform: "darwin",
			atomicCloneDirectory: async () => {
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
		const thirdError = await cloneDir(source, destination, {
			platform: "darwin",
		}).catch((error) => error);

		// Then the second owner's marker still excludes a third clone.
		expect(isCloneInProgressError(thirdError)).toBe(true);
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
