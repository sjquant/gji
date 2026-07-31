import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	chmod,
	cp,
	lstat,
	mkdir,
	mkdtemp,
	opendir,
	readdir,
	readFile,
	readlink,
	realpath,
	rename,
	rm,
	rmdir,
	symlink,
	unlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { GLOBAL_CONFIG_DIRECTORY } from "./config.js";
import { isAlreadyExistsError, isNotFoundError } from "./fs-utils.js";
import {
	inspectDestination,
	type OpenDestinationDirectory,
	openDestinationDirectory,
} from "./safe-destination.js";

const execFileAsync = promisify(execFile);
const CLONE_LOCK_TTL_MS = 24 * 60 * 60 * 1000;
const CLONE_GUARD_TTL_MS = 30 * 1000;
const CLONE_LOCK_SUFFIX = ".gji-clone-lock";
const SIZE_ESTIMATE_MAX_ENTRIES = 1_000_000;
const SIZE_ESTIMATE_MAX_MS = 5_000;
const MACOS_CLONE_HELPER_SOURCE = `
#include <errno.h>
#include <copyfile.h>
#include <dirent.h>
#include <fcntl.h>
#include <fts.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/clonefile.h>
#include <sys/stdio.h>
#include <sys/stat.h>
#include <unistd.h>

static int remove_tree_at(int parent_fd, const char *name) {
	int directory_fd = openat(parent_fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
	if (directory_fd < 0) return unlinkat(parent_fd, name, 0);
	DIR *directory = fdopendir(directory_fd);
	if (directory == NULL) {
		close(directory_fd);
		return -1;
	}
	int result = 0;
	struct dirent *entry;
	while ((entry = readdir(directory)) != NULL) {
		if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
		if (remove_tree_at(directory_fd, entry->d_name) != 0 && errno != ENOENT) {
			result = -1;
			break;
		}
	}
	int saved_errno = errno;
	closedir(directory);
	if (result != 0) {
		errno = saved_errno;
		return -1;
	}
	return unlinkat(parent_fd, name, AT_REMOVEDIR);
}

static char *destination_path(const char *root, const char *source, const char *path) {
	const char *relative = path + strlen(source);
	if (*relative == '/') relative++;
	size_t size = strlen(root) + strlen(relative) + 2;
	char *destination = malloc(size);
	if (destination == NULL) return NULL;
	if (*relative == '\\0') snprintf(destination, size, "%s", root);
	else snprintf(destination, size, "%s/%s", root, relative);
	return destination;
}

struct hardlink_entry {
	dev_t device;
	ino_t inode;
	char *target;
	struct hardlink_entry *next;
};

static const char *hardlink_target(struct hardlink_entry *entries, const struct stat *stats) {
	for (struct hardlink_entry *entry = entries; entry != NULL; entry = entry->next) {
		if (entry->device == stats->st_dev && entry->inode == stats->st_ino) return entry->target;
	}
	return NULL;
}

static int remember_hardlink(struct hardlink_entry **entries, const struct stat *stats, const char *target) {
	struct hardlink_entry *entry = malloc(sizeof(*entry));
	if (entry == NULL) return -1;
	entry->target = strdup(target);
	if (entry->target == NULL) {
		free(entry);
		return -1;
	}
	entry->device = stats->st_dev;
	entry->inode = stats->st_ino;
	entry->next = *entries;
	*entries = entry;
	return 0;
}

static void free_hardlinks(struct hardlink_entry *entries) {
	while (entries != NULL) {
		struct hardlink_entry *next = entries->next;
		free(entries->target);
		free(entries);
		entries = next;
	}
}

static int copy_directory_metadata(const char *source, int destination_fd, const char *target, const struct stat *stats, copyfile_flags_t flags) {
	int source_fd = open(source, O_RDONLY | O_DIRECTORY);
	int target_fd = openat(destination_fd, target, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
	int result = 0;
	if (source_fd < 0 || target_fd < 0 || fcopyfile(source_fd, target_fd, NULL, flags) != 0) {
		result = -1;
	}
	if (source_fd >= 0) close(source_fd);
	if (target_fd >= 0) close(target_fd);
	if (result != 0 || (flags & COPYFILE_STAT) == 0) return result;
	if (fchmodat(destination_fd, target, stats->st_mode & 07777, 0) != 0) return -1;
	struct timespec times[2] = {stats->st_atimespec, stats->st_mtimespec};
	return utimensat(destination_fd, target, times, 0);
}

static int clone_tree(const char *source, int destination_fd, const char *destination) {
	char *paths[] = {(char *)source, NULL};
	FTS *tree = fts_open(paths, FTS_NOCHDIR | FTS_PHYSICAL, NULL);
	if (tree == NULL) return -1;
	dev_t source_device = 0;
	int result = 0;
	struct hardlink_entry *hardlinks = NULL;
	FTSENT *entry;
	while (1) {
		errno = 0;
		entry = fts_read(tree);
		if (entry == NULL) {
			if (errno != 0) result = -1;
			break;
		}
		if (entry->fts_level == 0 && entry->fts_statp != NULL) {
			source_device = entry->fts_statp->st_dev;
		} else if (entry->fts_statp != NULL && entry->fts_statp->st_dev != source_device) {
			errno = EXDEV;
			result = -1;
			break;
		}

		char *target = destination_path(destination, source, entry->fts_path);
		if (target == NULL) {
			result = -1;
			break;
		}

		switch (entry->fts_info) {
			case FTS_D:
				if (mkdirat(destination_fd, target, 0700) != 0) result = -1;
				break;
			case FTS_DP:
				if (entry->fts_level > 0 && copy_directory_metadata(entry->fts_path, destination_fd, target, entry->fts_statp, COPYFILE_METADATA) != 0) result = -1;
				break;
			case FTS_F:
				{
					const char *existing = entry->fts_statp->st_nlink > 1 ? hardlink_target(hardlinks, entry->fts_statp) : NULL;
					if (existing != NULL) {
						if (linkat(destination_fd, existing, destination_fd, target, 0) != 0) result = -1;
					} else if (clonefileat(AT_FDCWD, entry->fts_path, destination_fd, target, CLONE_NOFOLLOW | CLONE_ACL) != 0) {
						result = -1;
					} else if (entry->fts_statp->st_nlink > 1 && remember_hardlink(&hardlinks, entry->fts_statp, target) != 0) {
						result = -1;
					}
				}
				break;
			case FTS_SL:
			case FTS_SLNONE:
				if (clonefileat(AT_FDCWD, entry->fts_path, destination_fd, target, CLONE_NOFOLLOW | CLONE_ACL) != 0) result = -1;
				break;
			case FTS_DNR:
			case FTS_ERR:
			case FTS_NS:
				errno = entry->fts_errno;
				result = -1;
				break;
			default:
				errno = ENOTSUP;
				result = -1;
		}
		free(target);
		if (result != 0) break;
	}
	int saved_errno = errno;
	fts_close(tree);
	free_hardlinks(hardlinks);
	errno = saved_errno;
	return result;
}

static int open_parent(int root_fd, const char *path) {
	int current = dup(root_fd);
	if (current < 0 || *path == '\0') return current;
	char *copy = strdup(path);
	if (copy == NULL) {
		close(current);
		return -1;
	}
	char *state = NULL;
	for (char *segment = strtok_r(copy, "/", &state); segment != NULL; segment = strtok_r(NULL, "/", &state)) {
		if (strcmp(segment, ".") == 0 || strcmp(segment, "..") == 0) {
			errno = EINVAL;
			close(current);
			current = -1;
			break;
		}
		if (mkdirat(current, segment, 0777) != 0 && errno != EEXIST) {
			close(current);
			current = -1;
			break;
		}
		int next = openat(current, segment, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
		if (next < 0) {
			close(current);
			current = -1;
			break;
		}
		close(current);
		current = next;
	}
	free(copy);
	return current;
}

int main(int argc, char **argv) {
	if (argc != 5) return 64;
	int parent_fd = open_parent(3, argv[2]);
	if (parent_fd < 0) {
		fprintf(stderr, "GJI_CLONE_ERROR:%s\\n", strerror(errno));
		return 70;
	}
	if (clonefileat(AT_FDCWD, argv[1], parent_fd, argv[4], CLONE_NOFOLLOW | CLONE_ACL) == 0) {
		close(parent_fd);
		return 0;
	}
	int error = errno;
	close(parent_fd);
	errno = error;
	if (errno == EEXIST) {
		fprintf(stderr, "GJI_CLONE_DESTINATION_EXISTS:%s\\n", strerror(errno));
		return 65;
	}
	if (errno == ENOTSUP || errno == EXDEV || errno == EINVAL) {
		fprintf(stderr, "GJI_CLONE_UNSUPPORTED:%s\\n", strerror(errno));
		return 69;
	}
	fprintf(stderr, "GJI_CLONE_ERROR:%s\\n", strerror(errno));
	return 70;
}
`;

let macOSCloneHelperPromise: Promise<string> | undefined;
const MACOS_CLONE_AT_SCRIPT = `
ObjC.import("Foundation");
ObjC.bindFunction("mkdirat", ["int", ["int", "char *", "unsigned short"]]);
ObjC.bindFunction("openat", ["int", ["int", "char *", "int", "unsigned short"]]);
ObjC.bindFunction("clonefileat", ["int", ["int", "char *", "int", "char *", "unsigned int"]]);
ObjC.bindFunction("close", ["int", ["int"]]);
ObjC.bindFunction("__error", ["pointer", []]);
function run(argv) {
	let parent = 3;
	const segments = argv[1] ? argv[1].split("/") : [];
	for (const segment of segments) {
		if (!segment || segment === "." || segment === "..") return "70:22";
		if ($.mkdirat(parent, segment, 511) !== 0 && $.__error()[0] !== 17) {
			const error = $.__error()[0];
			if (parent !== 3) $.close(parent);
			return "70:" + error;
		}
		const next = $.openat(parent, segment, Number(argv[3]), 0);
		if (next < 0) {
			const error = $.__error()[0];
			if (parent !== 3) $.close(parent);
			return "70:" + error;
		}
		if (parent !== 3) $.close(parent);
		parent = next;
	}
	const result = $.clonefileat(-2, argv[0], parent, argv[2], 5);
	const error = result === 0 ? 0 : $.__error()[0];
	if (parent !== 3) $.close(parent);
	if (result === 0) return "0";
	if (error === 17) return "65:" + error;
	if (error === 18 || error === 22 || error === 45 || error === 102) return "69:" + error;
	return "70:" + error;
}
`;

const LINUX_RENAME_HELPER_SOURCE = `
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/fs.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

int main(int argc, char **argv) {
	if (argc != 3 && argc != 4) return 64;
	int directory_fd = argc == 4 ? 3 : AT_FDCWD;
	if (syscall(SYS_renameat2, directory_fd, argv[1], directory_fd, argv[2], RENAME_NOREPLACE) == 0) return 0;
	if (errno == EEXIST) return 65;
	if (errno == ENOSYS || errno == EINVAL || errno == EOPNOTSUPP || errno == EXDEV) return 69;
	fprintf(stderr, "GJI_RENAME_ERROR:%s\\n", strerror(errno));
	return 70;
}
`;

let linuxRenameHelperPromise: Promise<string> | undefined;

export interface CloneDirResult {
	bytes?: number;
	ms: number;
}

export interface CloneRequestOptions {
	destinationRoot?: string;
	measureBytes?: boolean;
}

export interface CloneDirOptions extends CloneRequestOptions {
	platform?: NodeJS.Platform;
	runLinuxCommand?: (command: string, args: string[]) => Promise<void>;
	copyDirectory?: (source: string, destination: string) => Promise<void>;
	copyFile?: (source: string, destination: string) => Promise<void>;
	atomicCloneDirectory?: (source: string, destination: string) => Promise<void>;
}

export type CloneDirectory = {
	(
		source: string,
		destination: string,
		options?: CloneRequestOptions,
	): Promise<CloneDirResult>;
	readonly strategyIdentity?: string;
};

export function cloneStrategyIdentity(
	platform: NodeJS.Platform = process.platform,
): string {
	if (platform === "darwin") return "darwin-clonefile-tree-v3";
	if (platform === "linux") return "linux-cp-reflink-v1";
	return `unsupported-${platform}`;
}

export async function waitForCloneLock(
	destination: string,
	timeoutMs = 5_000,
	destinationRoot?: string,
): Promise<boolean> {
	const lockPath = cloneLockPath(
		destination,
		destinationRoot,
		process.platform,
	);
	const deadline = Date.now() + timeoutMs;
	while (await cloneLockExists(lockPath)) {
		if (await cloneLockIsStale(lockPath)) return true;
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return true;
}

async function cloneLockIsStale(lockPath: string): Promise<boolean> {
	try {
		const lock = await inspectCloneLock(lockPath);
		if (!lock) return false;
		const stats = await lstat(lock.markerPath);
		return Date.now() - stats.mtimeMs >= CLONE_LOCK_TTL_MS;
	} catch (error) {
		if (isNotFoundError(error)) return false;
		return false;
	}
}

async function cloneLockExists(lockPath: string): Promise<boolean> {
	try {
		return await destinationExists(lockPath);
	} catch (error) {
		if (
			"code" in (error as object) &&
			(error as NodeJS.ErrnoException).code === "ENOTDIR"
		) {
			return false;
		}
		throw error;
	}
}

function cloneLockPath(
	destination: string,
	destinationRoot: string | undefined,
	platform: NodeJS.Platform,
): string {
	if (platform !== "darwin" || !destinationRoot) {
		return `${destination}${CLONE_LOCK_SUFFIX}`;
	}
	const digest = createHash("sha256")
		.update(resolve(destination))
		.digest("hex")
		.slice(0, 16);
	return join(resolve(destinationRoot), `.gji-clone-${digest}.lock`);
}

export async function cloneDir(
	source: string,
	destination: string,
	options: CloneDirOptions = {},
): Promise<CloneDirResult> {
	const platform = options.platform ?? process.platform;
	const strategy = cloneStrategy(platform);
	if (!isClonePlatformSupported(platform)) {
		throw new CloneUnsupportedError(`platform ${platform} has no CoW strategy`);
	}

	const sourcePath = await realpath(source);
	const sourceStats = await lstat(sourcePath);
	if (!sourceStats.isDirectory()) {
		throw new Error("source is not a directory");
	}
	const destinationPath = await resolveProspectivePath(destination);
	const destinationDistance = relative(sourcePath, destinationPath);
	if (
		destinationDistance === "" ||
		(destinationDistance !== ".." &&
			!destinationDistance.startsWith(`..${sep}`))
	) {
		throw new Error("clone destination must not be inside its source");
	}
	if (await destinationExists(destination)) {
		throw new CloneDestinationExistsError(destination);
	}

	const startedAt = Date.now();
	const parent = dirname(destination);
	let safeParent: OpenDestinationDirectory | undefined;
	try {
		if (options.destinationRoot) {
			const parentInspection = await inspectDestination(
				options.destinationRoot,
				parent,
			);
			if (parentInspection.kind === "unsafe") {
				throw new Error(parentInspection.reason);
			}
			safeParent = await openDestinationDirectory(
				options.destinationRoot,
				parent,
				!platformIsDarwin(platform),
			);
		} else {
			await mkdir(parent, { recursive: true });
			if (platformIsDarwin(platform)) {
				safeParent = await openDestinationDirectory(parent, parent);
			}
		}
		const operationParent = safeParent?.path ?? parent;
		const operationDestination = join(operationParent, basename(destination));
		if (await destinationExists(operationDestination)) {
			throw new CloneDestinationExistsError(destination);
		}
		const lockPath = cloneLockPath(
			destination,
			options.destinationRoot,
			platform,
		);
		const cloneLock = await acquireCloneLock(lockPath, destination);
		const stopLockHeartbeat = startLockHeartbeat(cloneLock);

		let temporaryRoot: string | undefined;
		let reservationPath: string | undefined;
		const reservationEntries: string[] = [];
		try {
			if (platformIsDarwin(platform)) {
				try {
					if (options.atomicCloneDirectory) {
						await options.atomicCloneDirectory(
							sourcePath,
							operationDestination,
						);
					} else {
						await runNativeCloneDirectory(
							sourcePath,
							operationDestination,
							safeParent?.fd,
							safeParent?.relativePath ?? "",
						);
					}
				} catch (error) {
					if (isNativeDestinationExistsError(error)) {
						throw new CloneDestinationExistsError(destination);
					}
					if (error instanceof CloneSetupError) throw error;
					if (error instanceof CloneUnsupportedError) throw error;
					if (isUnsupportedCloneError(error)) {
						throw new CloneUnsupportedError(toErrorMessage(error));
					}
					throw error;
				}
				return cloneResult(sourcePath, startedAt, options.measureBytes);
			}
			if (
				platform === "linux" &&
				options.copyDirectory === undefined &&
				options.copyFile === undefined &&
				options.runLinuxCommand === undefined
			) {
				await linuxRenameHelper();
				temporaryRoot = await mkdtemp(
					join(operationParent, `.${basename(destination)}.gji-clone-`),
				);
				const temporaryDestination = join(temporaryRoot, basename(destination));
				try {
					await runNativeLinuxClone(
						sourcePath,
						temporaryDestination,
						operationParent,
						safeParent?.fd,
					);
					await publishNativeLinuxClone(
						temporaryDestination,
						operationDestination,
						operationParent,
						safeParent?.fd,
					);
				} catch (error) {
					if (isNativeDestinationExistsError(error)) {
						throw new CloneDestinationExistsError(destination);
					}
					if (isUnsupportedCloneError(error)) {
						throw new CloneUnsupportedError(toErrorMessage(error));
					}
					throw error;
				}
				return cloneResult(sourcePath, startedAt, options.measureBytes);
			}

			reservationPath = await reserveDestination(operationDestination);
			temporaryRoot = await mkdtemp(
				join(operationParent, `.${basename(destination)}.gji-clone-`),
			);
			const temporaryDestination = join(temporaryRoot, basename(destination));
			const copyDirectory =
				options.copyDirectory ??
				(async (source, target) => {
					if (!strategy) {
						throw new CloneUnsupportedError(
							`platform ${platform} has no CoW strategy`,
						);
					}
					const runCommand = options.runLinuxCommand ?? runCloneCommand;
					await runCommand("cp", strategy(source, target));
				});
			try {
				await copyDirectory(sourcePath, temporaryDestination);
			} catch (error) {
				if (isUnsupportedCloneError(error)) {
					throw new CloneUnsupportedError(toErrorMessage(error));
				}
				throw error;
			}

			await publishCloneContents(
				temporaryDestination,
				operationDestination,
				reservationPath,
				(entry) => reservationEntries.push(entry),
				options.copyFile ?? runForcedCloneFileCopy,
			);
			reservationPath = undefined;
		} finally {
			stopLockHeartbeat();
			if (reservationPath) {
				await cleanupReservedDestination(
					operationDestination,
					reservationPath,
					reservationEntries,
				);
			}
			try {
				if (temporaryRoot) {
					await rm(temporaryRoot, { force: true, recursive: true });
				}
			} catch {
				// Cleanup is best effort and must not mask the clone result.
			}
			try {
				await releaseCloneLock(cloneLock);
			} catch {
				// A stale lock is reclaimed on a later attempt.
			}
		}

		return cloneResult(sourcePath, startedAt, options.measureBytes);
	} finally {
		await safeParent?.close().catch(() => undefined);
	}
}

async function resolveProspectivePath(path: string): Promise<string> {
	let current = resolve(path);
	const missing: string[] = [];
	while (true) {
		try {
			return join(await realpath(current), ...missing);
		} catch (error) {
			if (!isNotFoundError(error)) throw error;
			const parent = dirname(current);
			if (parent === current) throw error;
			missing.unshift(basename(current));
			current = parent;
		}
	}
}

export namespace cloneDir {
	export const strategyIdentity = cloneStrategyIdentity();
}

async function runNativeCloneDirectory(
	source: string,
	destination: string,
	destinationParentFd: number | undefined,
	destinationParentRelative: string,
): Promise<void> {
	if (destinationParentFd === undefined) {
		throw new CloneUnsupportedError("safe destination handle is unavailable");
	}
	let status: string;
	try {
		status = await runMacOSCloneAt(
			[
				source,
				destinationParentRelative,
				basename(destination),
				String(
					constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
				),
			],
			destinationParentFd,
		);
	} catch {
		const helper = await macOSCloneHelper();
		try {
			await runNativeCloneProcess(
				helper,
				[
					source,
					destinationParentRelative,
					"unused-staging-name",
					basename(destination),
				],
				destinationParentFd,
			);
			return;
		} catch (error) {
			if (error instanceof NativeCloneProcessError && error.exitCode === 65) {
				throw new CloneDestinationExistsError(destination);
			}
			if (error instanceof NativeCloneProcessError && error.exitCode === 69) {
				throw new CloneUnsupportedError(error.stderr.trim());
			}
			throw error;
		}
	}
	const exitCode = Number(status.split(":", 1)[0]);
	if (exitCode === 0) return;
	if (exitCode === 65) throw new CloneDestinationExistsError(destination);
	if (exitCode === 69) {
		throw new CloneUnsupportedError(`clonefileat failed (${status})`);
	}
	throw new Error(`native clonefileat failed (${status})`);
}

async function runMacOSCloneAt(
	args: string[],
	destinationParentFd: number,
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const child = spawn(
			"/usr/bin/osascript",
			["-l", "JavaScript", "-e", MACOS_CLONE_AT_SCRIPT, ...args],
			{ stdio: ["ignore", "pipe", "pipe", destinationParentFd] },
		);
		let stdout = "";
		let stderr = "";
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) resolve(stdout.trim());
			else reject(new Error(`native clonefileat failed: ${stderr.trim()}`));
		});
	});
}

class NativeCloneProcessError extends Error {
	constructor(
		readonly exitCode: number | null,
		readonly stderr: string,
	) {
		super(
			`native clone helper exited with code ${String(exitCode)}: ${stderr.trim()}`,
		);
		this.name = "NativeCloneProcessError";
	}
}

class CloneSetupError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CloneSetupError";
	}
}

async function runNativeCloneProcess(
	command: string,
	args: string[],
	destinationParentFd?: number,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "ignore", "pipe", destinationParentFd ?? "ignore"],
		});
		let stderr = "";
		const stderrStream = child.stderr;
		if (!stderrStream) {
			reject(new Error("native clone helper stderr is unavailable"));
			return;
		}
		stderrStream.setEncoding("utf8");
		stderrStream.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) resolve();
			else reject(new NativeCloneProcessError(code, stderr));
		});
	});
}

async function runNativeLinuxClone(
	source: string,
	destination: string,
	operationParent: string,
	destinationParentFd: number | undefined,
): Promise<void> {
	const target = destinationParentFd
		? inheritedDirectoryPath(operationParent, destination)
		: destination;
	if (destinationParentFd) {
		await runCommandWithInheritedDirectory(
			"cp",
			["-a", "--reflink=always", source, target],
			destinationParentFd,
		);
		return;
	}
	await runCloneCommand("cp", ["-a", "--reflink=always", source, target]);
}

async function publishNativeLinuxClone(
	source: string,
	destination: string,
	operationParent: string,
	destinationParentFd: number | undefined,
): Promise<void> {
	const sourceOperand = destinationParentFd
		? relative(operationParent, source)
		: source;
	const destinationOperand = destinationParentFd
		? relative(operationParent, destination)
		: destination;
	const helper = await linuxRenameHelper();
	try {
		await runNativeCloneProcess(
			helper,
			[
				sourceOperand,
				destinationOperand,
				...(destinationParentFd === undefined ? [] : ["fd3"]),
			],
			destinationParentFd,
		);
	} catch (error) {
		if (error instanceof NativeCloneProcessError && error.exitCode === 65) {
			throw new CloneDestinationExistsError(destination);
		}
		if (error instanceof NativeCloneProcessError && error.exitCode === 69) {
			throw new CloneUnsupportedError(
				"atomic no-replace publication is unavailable",
			);
		}
		throw error;
	}
}

function inheritedDirectoryPath(root: string, path: string): string {
	return join("/proc/self/fd/3", relative(root, path));
}

async function runCommandWithInheritedDirectory(
	command: string,
	args: string[],
	directoryFd: number,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "ignore", "pipe", directoryFd],
		});
		let stderr = "";
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) resolve();
			else
				reject(
					new Error(
						`${command} failed with code ${String(code)}: ${stderr.trim()}`,
					),
				);
		});
	});
}

async function macOSCloneHelper(): Promise<string> {
	const pending = macOSCloneHelperPromise ?? compileMacOSCloneHelper();
	macOSCloneHelperPromise = pending;
	try {
		return await pending;
	} catch (error) {
		if (macOSCloneHelperPromise === pending)
			macOSCloneHelperPromise = undefined;
		throw error;
	}
}

async function compileMacOSCloneHelper(): Promise<string> {
	const digest = createHash("sha256")
		.update(MACOS_CLONE_HELPER_SOURCE)
		.digest("hex")
		.slice(0, 16);
	const configRoot = process.env.GJI_CONFIG_DIR
		? resolve(process.env.GJI_CONFIG_DIR)
		: join(homedir(), GLOBAL_CONFIG_DIRECTORY);
	const helperRoot = join(
		configRoot,
		"native",
		`darwin-${process.arch}-${digest}`,
	);
	const executable = join(helperRoot, "clone");
	try {
		await access(executable, constants.X_OK);
		return executable;
	} catch {
		// Compile once below and reuse the versioned helper across CLI processes.
	}

	await mkdir(helperRoot, { recursive: true });
	const buildRoot = await mkdtemp(join(helperRoot, ".build-"));
	const source = join(buildRoot, "clone.c");
	const buildExecutable = join(buildRoot, "clone");
	try {
		await writeFile(source, MACOS_CLONE_HELPER_SOURCE, "utf8");
		await execFileAsync("/usr/bin/cc", ["-Os", "-o", buildExecutable, source]);
		await chmod(buildExecutable, 0o700);
		await rename(buildExecutable, executable);
		return executable;
	} catch (error) {
		throw new CloneSetupError(
			`macOS clone helper setup failed: ${toErrorMessage(error)}`,
		);
	} finally {
		await rm(buildRoot, { force: true, recursive: true }).catch(
			() => undefined,
		);
	}
}

async function linuxRenameHelper(): Promise<string> {
	const pending = linuxRenameHelperPromise ?? compileLinuxRenameHelper();
	linuxRenameHelperPromise = pending;
	try {
		return await pending;
	} catch (error) {
		if (linuxRenameHelperPromise === pending)
			linuxRenameHelperPromise = undefined;
		throw error;
	}
}

async function compileLinuxRenameHelper(): Promise<string> {
	const digest = createHash("sha256")
		.update(LINUX_RENAME_HELPER_SOURCE)
		.digest("hex")
		.slice(0, 16);
	const configRoot = process.env.GJI_CONFIG_DIR
		? resolve(process.env.GJI_CONFIG_DIR)
		: join(homedir(), GLOBAL_CONFIG_DIRECTORY);
	const helperRoot = join(
		configRoot,
		"native",
		`linux-${process.arch}-${digest}`,
	);
	const executable = join(helperRoot, "rename-noreplace");
	try {
		await access(executable, constants.X_OK);
		return executable;
	} catch {
		// Compile once below and reuse the versioned helper across CLI processes.
	}

	await mkdir(helperRoot, { recursive: true });
	const buildRoot = await mkdtemp(join(helperRoot, ".build-"));
	const source = join(buildRoot, "rename.c");
	const buildExecutable = join(buildRoot, "rename-noreplace");
	try {
		await writeFile(source, LINUX_RENAME_HELPER_SOURCE, "utf8");
		await execFileAsync("cc", ["-Os", "-o", buildExecutable, source]);
		await chmod(buildExecutable, 0o700);
		await rename(buildExecutable, executable);
		return executable;
	} catch (error) {
		throw new CloneSetupError(
			`Linux atomic publication helper setup failed: ${toErrorMessage(error)}`,
		);
	} finally {
		await rm(buildRoot, { force: true, recursive: true }).catch(
			() => undefined,
		);
	}
}

function isNativeDestinationExistsError(error: unknown): boolean {
	return (
		error instanceof CloneDestinationExistsError ||
		(error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "EEXIST")
	);
}

async function cloneResult(
	source: string,
	startedAt: number,
	measureBytes: boolean | undefined,
): Promise<CloneDirResult> {
	const bytes =
		measureBytes === false ? undefined : await estimateCloneBytes(source);
	return { bytes, ms: Date.now() - startedAt };
}

export class CloneDestinationExistsError extends Error {
	readonly code = "GJI_CLONE_DESTINATION_EXISTS";

	constructor(destination: string) {
		super(`destination already exists: ${destination}`);
		this.name = "CloneDestinationExistsError";
	}
}

export class CloneUnsupportedError extends Error {
	readonly code = "GJI_CLONE_UNSUPPORTED";

	constructor(reason: string) {
		super(`copy-on-write cloning is not supported: ${reason}`);
		this.name = "CloneUnsupportedError";
	}
}

export class CloneInProgressError extends Error {
	readonly code = "GJI_CLONE_IN_PROGRESS";

	constructor(destination: string) {
		super(`copy-on-write clone already in progress: ${destination}`);
		this.name = "CloneInProgressError";
	}
}

export function isCloneDestinationExistsError(
	error: unknown,
): error is CloneDestinationExistsError {
	return error instanceof CloneDestinationExistsError;
}

export function isCloneUnsupportedError(error: unknown): boolean {
	return (
		error instanceof CloneUnsupportedError || isUnsupportedCloneError(error)
	);
}

export function isCloneInProgressError(
	error: unknown,
): error is CloneInProgressError {
	return error instanceof CloneInProgressError;
}

export async function directorySize(path: string): Promise<number> {
	const stats = await lstat(path);
	if (!stats.isDirectory()) return stats.size;

	const pending = [path];
	let total = 0;
	let entryCount = 0;
	const startedAt = Date.now();
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) continue;
		const directory = await opendir(current);
		try {
			for await (const entry of directory) {
				entryCount += 1;
				if (
					entryCount > SIZE_ESTIMATE_MAX_ENTRIES ||
					Date.now() - startedAt > SIZE_ESTIMATE_MAX_MS
				) {
					throw new Error("directory size estimate exceeded its safety limit");
				}
				const entryPath = join(current, entry.name);
				if (entry.isDirectory()) pending.push(entryPath);
				else total += (await lstat(entryPath)).size;
			}
		} finally {
			await directory.close().catch(() => undefined);
		}
	}

	return total;
}

function cloneStrategy(
	platform: NodeJS.Platform,
): ((source: string, destination: string) => string[]) | null {
	if (platform === "linux") {
		return (source, destination) => [
			"-a",
			"--reflink=always",
			source,
			destination,
		];
	}

	return null;
}

function isClonePlatformSupported(platform: NodeJS.Platform): boolean {
	return platform === "darwin" || platform === "linux";
}

async function estimateCloneBytes(path: string): Promise<number | undefined> {
	try {
		return await directorySize(path);
	} catch {
		return undefined;
	}
}

async function runCloneCommand(command: string, args: string[]): Promise<void> {
	try {
		await execFileAsync(command, args);
	} catch (error) {
		if (isUnsupportedCloneError(error)) {
			throw new CloneUnsupportedError(toErrorMessage(error));
		}
		throw error;
	}
}

async function acquireCloneLock(
	lockPath: string,
	destination: string,
): Promise<CloneLock> {
	const releaseGuard = await acquireCloneLockGuard(lockPath, destination);
	try {
		return await acquireCloneLockWithGuard(lockPath, destination);
	} finally {
		await releaseGuard();
	}
}

async function acquireCloneLockWithGuard(
	lockPath: string,
	destination: string,
): Promise<CloneLock> {
	const lockToken = randomUUID();
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const published = await publishCloneLock(lockPath, lockToken);
		if (published) return published;

		let lockStats: Awaited<ReturnType<typeof lstat>>;
		let staleLock: CloneLock;
		try {
			const inspected = await inspectCloneLock(lockPath);
			if (!inspected) throw new CloneInProgressError(destination);
			staleLock = inspected;
			lockStats = await lstat(staleLock.markerPath);
		} catch (error) {
			if (isNotFoundError(error)) continue;
			throw error;
		}
		if (Date.now() - lockStats.mtimeMs < CLONE_LOCK_TTL_MS) {
			throw new CloneInProgressError(destination);
		}

		const stalePath = `${lockPath}.stale-${randomUUID()}`;
		try {
			await rename(lockPath, stalePath);
		} catch (error) {
			if (isNotFoundError(error)) continue;
			throw error;
		}

		try {
			const replacement = await publishCloneLock(lockPath, lockToken);
			if (!replacement) {
				await cleanupStaleCloneLock(stalePath, staleLock.markerName);
				continue;
			}
			try {
				await cleanupStaleCloneLock(stalePath, staleLock.markerName);
			} catch (cleanupError) {
				await releaseCloneLockWithGuard(replacement).catch(() => undefined);
				throw cleanupError;
			}
			return replacement;
		} catch (error) {
			await cleanupStaleCloneLock(stalePath, staleLock.markerName).catch(
				() => undefined,
			);
			if (isAlreadyExistsError(error)) continue;
			throw error;
		}
	}

	throw new CloneInProgressError(destination);
}

async function acquireCloneLockGuard(
	lockPath: string,
	destination: string,
): Promise<() => Promise<void>> {
	const guardPath = `${lockPath}.guard`;
	const deadline = Date.now() + 5_000;
	while (true) {
		try {
			await mkdir(guardPath, { mode: 0o700 });
			const markerName = `${process.pid}-${randomUUID()}`;
			const markerPath = join(guardPath, markerName);
			try {
				await writeFile(markerPath, `${markerName}\n`, {
					flag: "wx",
					mode: 0o600,
				});
			} catch (error) {
				await rmdir(guardPath).catch(() => undefined);
				throw error;
			}
			return async () => {
				await unlink(markerPath).catch((error) => {
					if (!isNotFoundError(error)) throw error;
				});
				await rmdir(guardPath).catch((error) => {
					if (!isNotFoundError(error)) throw error;
				});
			};
		} catch (error) {
			if (!isAlreadyExistsError(error)) throw error;
			if (await reclaimAbandonedCloneGuard(guardPath)) continue;
			if (Date.now() >= deadline) {
				throw new CloneInProgressError(destination);
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
}

async function reclaimAbandonedCloneGuard(guardPath: string): Promise<boolean> {
	let expectedMarker: string | undefined;
	try {
		const entries = await readdir(guardPath);
		if (entries.length > 1) return false;
		expectedMarker = entries[0];
		const freshnessPath = expectedMarker
			? join(guardPath, expectedMarker)
			: guardPath;
		const stats = await lstat(freshnessPath);
		if (Date.now() - stats.mtimeMs < CLONE_GUARD_TTL_MS) return false;
		if (expectedMarker) {
			const ownerPid = Number(expectedMarker.split("-", 1)[0]);
			if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) return false;
			if (processIsAlive(ownerPid)) return false;
		}
	} catch (error) {
		return isNotFoundError(error);
	}

	const stalePath = `${guardPath}.stale-${randomUUID()}`;
	try {
		await rename(guardPath, stalePath);
	} catch (error) {
		if (isNotFoundError(error)) return true;
		throw error;
	}
	const movedEntries = await readdir(stalePath).catch(() => []);
	if (
		movedEntries.length !== (expectedMarker ? 1 : 0) ||
		(expectedMarker && movedEntries[0] !== expectedMarker)
	) {
		await rename(stalePath, guardPath).catch(() => undefined);
		return false;
	}
	if (expectedMarker) await unlink(join(stalePath, expectedMarker));
	await rmdir(stalePath);
	return true;
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

async function publishCloneLock(
	lockPath: string,
	lockToken: string,
): Promise<CloneLock | undefined> {
	try {
		await mkdir(lockPath, { mode: 0o700 });
	} catch (error) {
		if (isAlreadyExistsError(error)) return undefined;
		throw error;
	}
	const markerPath = join(lockPath, lockToken);
	try {
		await writeFile(markerPath, `${lockToken}\n`, { flag: "wx", mode: 0o600 });
		return {
			lockPath,
			markerName: lockToken,
			markerPath,
			token: lockToken,
		};
	} catch (error) {
		await rmdir(lockPath).catch(() => undefined);
		throw error;
	}
}

interface CloneLock {
	lockPath: string;
	markerName: string;
	markerPath: string;
	token: string;
}

async function inspectCloneLock(
	lockPath: string,
): Promise<CloneLock | undefined> {
	try {
		const stats = await lstat(lockPath);
		if (!stats.isDirectory() || stats.isSymbolicLink()) return undefined;
		const entries = await readdir(lockPath);
		if (entries.length !== 1) return undefined;
		const markerName = entries[0];
		const token = markerName?.startsWith("owner-")
			? markerName.slice("owner-".length)
			: markerName;
		if (!token || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(token)) {
			return undefined;
		}
		const markerPath = join(lockPath, markerName as string);
		const markerStats = await lstat(markerPath);
		if (!markerStats.isFile() || markerStats.isSymbolicLink()) return undefined;
		if ((await readFile(markerPath, "utf8")).trim() !== token) return undefined;
		return { lockPath, markerName: markerName as string, markerPath, token };
	} catch (error) {
		if (isNotFoundError(error)) throw error;
		return undefined;
	}
}

async function cleanupStaleCloneLock(
	lockPath: string,
	markerName: string,
): Promise<void> {
	await unlink(join(lockPath, markerName));
	await rmdir(lockPath);
}

async function publishCloneContents(
	temporaryDestination: string,
	destination: string,
	reservationPath: string,
	onEntryPublished: (entry: string) => void,
	copyFileEntry: (source: string, destination: string) => Promise<void>,
): Promise<void> {
	const reservationName = basename(reservationPath);
	const destinationEntries = await readdir(destination);
	if (
		destinationEntries.length !== 1 ||
		destinationEntries[0] !== reservationName
	) {
		throw new CloneDestinationExistsError(destination);
	}

	const temporaryEntries = await readdir(temporaryDestination);
	for (const entry of temporaryEntries) {
		await publishCloneEntry(
			join(temporaryDestination, entry),
			join(destination, entry),
			() => onEntryPublished(entry),
			copyFileEntry,
		);
	}

	await unlink(reservationPath);
}

async function publishCloneEntry(
	source: string,
	destination: string,
	onCreated: () => void,
	copyFileEntry: (source: string, destination: string) => Promise<void>,
): Promise<void> {
	const sourceStats = await lstat(source);
	if (sourceStats.isDirectory()) {
		try {
			await mkdir(destination);
		} catch (error) {
			if (isAlreadyExistsError(error)) {
				throw new CloneDestinationExistsError(destination);
			}
			throw error;
		}
		onCreated();
		for (const entry of await readdir(source)) {
			await publishCloneEntry(
				join(source, entry),
				join(destination, entry),
				() => undefined,
				copyFileEntry,
			);
		}
		await copyCloneMetadata(sourceStats, destination);
		return;
	}

	if (sourceStats.isSymbolicLink()) {
		try {
			await symlink(await readlink(source), destination);
		} catch (error) {
			if (isAlreadyExistsError(error)) {
				throw new CloneDestinationExistsError(destination);
			}
			throw error;
		}
		onCreated();
		return;
	}

	if (!sourceStats.isFile()) {
		throw new Error(`unsupported clone entry type: ${source}`);
	}

	try {
		await copyFileEntry(source, destination);
	} catch (error) {
		if (isAlreadyExistsError(error)) {
			throw new CloneDestinationExistsError(destination);
		}
		if (isUnsupportedCloneError(error)) {
			throw new CloneUnsupportedError(toErrorMessage(error));
		}
		throw error;
	}
	onCreated();
	await copyCloneMetadata(sourceStats, destination);
}

async function runForcedCloneFileCopy(
	source: string,
	destination: string,
): Promise<void> {
	await cp(source, destination, {
		errorOnExist: true,
		force: false,
		mode: constants.COPYFILE_FICLONE_FORCE,
		preserveTimestamps: true,
	});
}

async function copyCloneMetadata(
	sourceStats: Awaited<ReturnType<typeof lstat>>,
	destination: string,
): Promise<void> {
	await chmod(destination, Number(sourceStats.mode) & 0o7777);
	await utimes(destination, sourceStats.atime, sourceStats.mtime);
}

async function reserveDestination(destination: string): Promise<string> {
	try {
		await mkdir(destination);
	} catch (error) {
		if (isAlreadyExistsError(error)) {
			throw new CloneDestinationExistsError(destination);
		}
		throw error;
	}

	const reservationPath = join(
		destination,
		`.gji-clone-reservation-${randomUUID()}`,
	);
	try {
		await writeFile(reservationPath, "gji clone reservation\n", {
			flag: "wx",
		});
		return reservationPath;
	} catch (error) {
		await rmdir(destination).catch(() => undefined);
		throw error;
	}
}

async function cleanupReservedDestination(
	destination: string,
	reservationPath: string,
	reservationEntries: readonly string[],
): Promise<void> {
	try {
		const entries = await readdir(destination);
		const ownedEntries = new Set([
			basename(reservationPath),
			...reservationEntries,
		]);
		if (entries.every((entry) => ownedEntries.has(entry))) {
			await rm(destination, { force: true, recursive: true });
		}
	} catch {
		// Preserve a destination that was changed by another process.
	}
}

async function destinationExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (isNotFoundError(error)) return false;
		throw error;
	}
}

function startLockHeartbeat(lock: CloneLock): () => void {
	const timer = setInterval(() => {
		void refreshCloneLock(lock);
	}, CLONE_LOCK_TTL_MS / 3);
	timer.unref?.();
	return () => clearInterval(timer);
}

async function refreshCloneLock(lock: CloneLock): Promise<void> {
	try {
		const now = new Date();
		await utimes(lock.markerPath, now, now);
	} catch {
		// A missing marker means this owner was already fenced out as stale.
	}
}

async function releaseCloneLock(lock: CloneLock): Promise<void> {
	const releaseGuard = await acquireCloneLockGuard(
		lock.lockPath,
		lock.lockPath,
	);
	try {
		await releaseCloneLockWithGuard(lock);
	} finally {
		await releaseGuard();
	}
}

async function releaseCloneLockWithGuard(lock: CloneLock): Promise<void> {
	try {
		await unlink(join(lock.lockPath, lock.token));
	} catch (error) {
		if (!isNotFoundError(error)) throw error;
	}
	try {
		await rmdir(lock.lockPath);
	} catch (error) {
		const code =
			"code" in (error as object)
				? (error as NodeJS.ErrnoException).code
				: undefined;
		if (!isNotFoundError(error) && code !== "ENOTEMPTY" && code !== "EEXIST") {
			throw error;
		}
	}
}

function isUnsupportedCloneError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;

	const code = "code" in error ? (error as NodeJS.ErrnoException).code : "";
	if (
		["EINVAL", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(code ?? "")
	) {
		return true;
	}

	return /clonefile|reflink|unsupported|operation not supported|not supported|invalid cross-device|cross-device/iu.test(
		error.message,
	);
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function platformIsDarwin(platform: NodeJS.Platform): boolean {
	return platform === "darwin";
}
