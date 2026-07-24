import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	opendir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	rmdir,
	unlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import { isAlreadyExistsError, isNotFoundError } from "./fs-utils.js";
import {
	ensureDestinationDirectory,
	inspectDestination,
} from "./safe-destination.js";

const execFileAsync = promisify(execFile);
const CLONE_LOCK_TTL_MS = 24 * 60 * 60 * 1000;
const CLONE_LOCK_SUFFIX = ".gji-clone-lock";
const SIZE_ESTIMATE_MAX_ENTRIES = 1_000_000;
const SIZE_ESTIMATE_MAX_MS = 5_000;

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
	runCommand?: (command: string, args: string[]) => Promise<void>;
	copyDirectory?: (source: string, destination: string) => Promise<void>;
}

export type CloneDirectory = (
	source: string,
	destination: string,
	options?: CloneRequestOptions,
) => Promise<CloneDirResult>;

export async function waitForCloneLock(
	destination: string,
	timeoutMs = 5_000,
): Promise<boolean> {
	const lockPath = `${destination}${CLONE_LOCK_SUFFIX}`;
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
		const freshnessPath = await lockFreshnessPath(lockPath);
		const stats = await lstat(freshnessPath);
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
	if (await destinationExists(destination)) {
		throw new CloneDestinationExistsError(destination);
	}

	const startedAt = Date.now();
	const parent = dirname(destination);
	if (options.destinationRoot) {
		const parentInspection = await inspectDestination(
			options.destinationRoot,
			parent,
		);
		if (parentInspection.kind === "unsafe") {
			throw new Error(parentInspection.reason);
		}
	}
	if (options.destinationRoot) {
		await ensureDestinationDirectory(options.destinationRoot, parent);
	} else {
		await mkdir(parent, { recursive: true });
	}
	if (options.destinationRoot) {
		const parentInspection = await inspectDestination(
			options.destinationRoot,
			parent,
		);
		if (parentInspection.kind === "unsafe") {
			throw new Error(parentInspection.reason);
		}
	}
	const lockPath = `${destination}${CLONE_LOCK_SUFFIX}`;
	const lockToken = await acquireCloneLock(lockPath, destination);
	const stopLockHeartbeat = startLockHeartbeat(lockPath, lockToken);

	let temporaryRoot: string | undefined;
	let reservationPath: string | undefined;
	const reservationEntries: string[] = [];
	try {
		reservationPath = await reserveDestination(destination);
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

		await publishCloneContents(
			temporaryDestination,
			destination,
			reservationPath,
			(entry) => reservationEntries.push(entry),
		);
		reservationPath = undefined;
	} finally {
		stopLockHeartbeat();
		if (reservationPath) {
			await cleanupReservedDestination(
				destination,
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
			await releaseCloneLock(lockPath, lockToken);
		} catch {
			// A stale lock is reclaimed on a later attempt.
		}
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
): Promise<string> {
	const lockToken = randomUUID();
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await mkdir(lockPath);
			try {
				await writeFile(
					join(lockPath, ownerFileName(lockToken)),
					`${lockToken}\n`,
					{
						flag: "wx",
					},
				);
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
			lockStats = await lstat(await lockFreshnessPath(lockPath));
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
				await writeFile(
					join(lockPath, ownerFileName(lockToken)),
					`${lockToken}\n`,
					{
						flag: "wx",
					},
				);
			} catch (error) {
				await rm(lockPath, { force: true, recursive: true });
				throw error;
			}
			try {
				await rm(stalePath, { force: true, recursive: true });
			} catch (cleanupError) {
				await releaseCloneLock(lockPath, lockToken).catch(() => undefined);
				throw cleanupError;
			}
			return lockToken;
		} catch (error) {
			await rm(stalePath, { force: true, recursive: true }).catch(
				() => undefined,
			);
			if (isAlreadyExistsError(error)) continue;
			throw error;
		}
	}

	throw new CloneInProgressError(destination);
}

async function lockFreshnessPath(lockPath: string): Promise<string> {
	try {
		const entries = await readdir(lockPath);
		const owner = entries.find((entry) => entry.startsWith("owner-"));
		return owner ? join(lockPath, owner) : lockPath;
	} catch (error) {
		if (isNotFoundError(error)) throw error;
		return lockPath;
	}
}

async function publishCloneContents(
	temporaryDestination: string,
	destination: string,
	reservationPath: string,
	onEntryPublished: (entry: string) => void,
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
		const destinationEntry = join(destination, entry);
		if (await destinationExists(destinationEntry)) {
			throw new CloneDestinationExistsError(destination);
		}
		try {
			await rename(join(temporaryDestination, entry), destinationEntry);
		} catch (error) {
			if (isAlreadyExistsError(error)) {
				throw new CloneDestinationExistsError(destination);
			}
			throw error;
		}
		onEntryPublished(entry);
	}

	await unlink(reservationPath);
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
		const ownerPath = join(lockPath, ownerFileName(lockToken));
		await readFile(ownerPath, "utf8");
		const now = new Date();
		await utimes(ownerPath, now, now);
	} catch {
		// Lock refresh is advisory; the owner check prevents touching a replacement lock.
	}
}

async function releaseCloneLock(
	lockPath: string,
	lockToken: string,
): Promise<void> {
	try {
		const ownerPath = join(lockPath, ownerFileName(lockToken));
		await unlink(ownerPath);
		await rmdir(lockPath);
	} catch (error) {
		if (!isNotFoundError(error) && !isDirectoryNotEmptyError(error))
			throw error;
	}
}

function ownerFileName(lockToken: string): string {
	return `owner-${lockToken}`;
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

function isDirectoryNotEmptyError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOTEMPTY"
	);
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function platformIsDarwin(platform: NodeJS.Platform): boolean {
	return platform === "darwin";
}
