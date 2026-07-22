import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import {
	isAlreadyExistsError,
	isNotFoundError,
	pathExists,
} from "./fs-utils.js";

const execFileAsync = promisify(execFile);
const CLONE_LOCK_TTL_MS = 24 * 60 * 60 * 1000;
const CLONE_LOCK_SUFFIX = ".gji-clone-lock";

export interface CloneDirResult {
	bytes?: number;
	ms: number;
}

export interface CloneRequestOptions {
	measureBytes?: boolean;
}

export interface CloneDirOptions extends CloneRequestOptions {
	platform?: NodeJS.Platform;
	runCommand?: (command: string, args: string[]) => Promise<void>;
	copyDirectory?: (source: string, destination: string) => Promise<void>;
}

export type CloneDirectory = (
	source: string,
	destination: string,
	options?: CloneRequestOptions,
) => Promise<CloneDirResult>;

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
	if (await pathExists(destination)) {
		throw new CloneDestinationExistsError(destination);
	}

	const startedAt = Date.now();
	const parent = dirname(destination);
	await mkdir(parent, { recursive: true });
	const lockPath = `${destination}${CLONE_LOCK_SUFFIX}`;
	const lockToken = await acquireCloneLock(lockPath, destination);
	const stopLockHeartbeat = startLockHeartbeat(lockPath, lockToken);

	let temporaryRoot: string | undefined;
	try {
		temporaryRoot = await mkdtemp(
			join(parent, `.${basename(destination)}.gji-clone-`),
		);
		const temporaryDestination = join(temporaryRoot, basename(destination));
		const copyDirectory =
			options.copyDirectory ??
			(platformIsDarwin(platform)
				? runNativeCloneDirectory
				: async (source, target) => {
						if (!strategy) {
							throw new CloneUnsupportedError(
								`platform ${platform} has no CoW strategy`,
							);
						}
						const runCommand = options.runCommand ?? runCloneCommand;
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

		await publishCloneContents(temporaryDestination, destination);
	} finally {
		stopLockHeartbeat();
		if (temporaryRoot) {
			await rm(temporaryRoot, { force: true, recursive: true });
		}
		await releaseCloneLock(lockPath, lockToken);
	}

	const bytes =
		options.measureBytes === false
			? undefined
			: await estimateCloneBytes(sourcePath);
	return { bytes, ms: Date.now() - startedAt };
}

async function runNativeCloneDirectory(
	source: string,
	destination: string,
): Promise<void> {
	await cp(source, destination, {
		errorOnExist: true,
		force: false,
		mode: constants.COPYFILE_FICLONE_FORCE,
		preserveTimestamps: true,
		recursive: true,
	});
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

	const entries = await readdir(path, { withFileTypes: true });
	let nextIndex = 0;
	let total = 0;
	const workerCount = Math.min(8, entries.length);
	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (nextIndex < entries.length) {
				const entry = entries[nextIndex];
				nextIndex += 1;
				total += await directorySize(join(path, entry.name));
			}
		}),
	);

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
): Promise<string> {
	const lockToken = randomUUID();
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await mkdir(lockPath);
			try {
				await writeFile(join(lockPath, "owner"), `${lockToken}\n`, {
					flag: "wx",
				});
			} catch (error) {
				await rm(lockPath, { force: true, recursive: true });
				throw error;
			}
			return lockToken;
		} catch (error) {
			if (!isAlreadyExistsError(error)) throw error;
		}

		let lockStats: Awaited<ReturnType<typeof lstat>>;
		try {
			lockStats = await lstat(lockPath);
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
			await mkdir(lockPath);
			try {
				await writeFile(join(lockPath, "owner"), `${lockToken}\n`, {
					flag: "wx",
				});
			} catch (error) {
				await rm(lockPath, { force: true, recursive: true });
				throw error;
			}
			await rm(stalePath, { force: true, recursive: true });
			return lockToken;
		} catch (error) {
			await rm(stalePath, { force: true, recursive: true });
			if (isAlreadyExistsError(error)) continue;
			throw error;
		}
	}

	throw new CloneInProgressError(destination);
}

async function publishCloneContents(
	temporaryDestination: string,
	destination: string,
): Promise<void> {
	try {
		await mkdir(destination);
	} catch (error) {
		if (isAlreadyExistsError(error)) {
			throw new CloneDestinationExistsError(destination);
		}
		throw error;
	}

	try {
		const entries = await readdir(temporaryDestination, {
			withFileTypes: true,
		});
		for (const entry of entries) {
			await rename(
				join(temporaryDestination, entry.name),
				join(destination, entry.name),
			);
		}
	} catch (error) {
		await rm(destination, { force: true, recursive: true });
		if (isAlreadyExistsError(error)) {
			throw new CloneDestinationExistsError(destination);
		}
		throw error;
	}
}

function startLockHeartbeat(lockPath: string, lockToken: string): () => void {
	const timer = setInterval(() => {
		void refreshCloneLock(lockPath, lockToken);
	}, CLONE_LOCK_TTL_MS / 3);
	timer.unref?.();
	return () => clearInterval(timer);
}

async function refreshCloneLock(
	lockPath: string,
	lockToken: string,
): Promise<void> {
	try {
		const owner = (await readFile(join(lockPath, "owner"), "utf8")).trim();
		if (owner === lockToken) {
			const now = new Date();
			await utimes(lockPath, now, now);
		}
	} catch {
		// Lock refresh is advisory; the owner check prevents touching a replacement lock.
	}
}

async function releaseCloneLock(
	lockPath: string,
	lockToken: string,
): Promise<void> {
	try {
		const owner = (await readFile(join(lockPath, "owner"), "utf8")).trim();
		if (owner === lockToken) {
			await rm(lockPath, { force: true, recursive: true });
		}
	} catch (error) {
		if (!isNotFoundError(error)) throw error;
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
