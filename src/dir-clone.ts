import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
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
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

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
			);
		} else {
			await mkdir(parent, { recursive: true });
		}

		const operationParent = safeParent?.path ?? parent;
		const operationDestination = join(operationParent, basename(destination));
		if (await destinationExists(operationDestination)) {
			throw new CloneDestinationExistsError(destination);
		}
		const cloneLock = await acquireCloneLock(
			`${operationDestination}${CLONE_LOCK_SUFFIX}`,
			destination,
		);
		const stopLockHeartbeat = startLockHeartbeat(cloneLock);

		let temporaryRoot: string | undefined;
		let reservationPath: string | undefined;
		const reservationEntries: string[] = [];
		try {
			reservationPath = await reserveDestination(operationDestination);
			temporaryRoot = await mkdtemp(
				join(operationParent, `.${basename(destination)}.gji-clone-`),
			);
			const temporaryDestination = join(temporaryRoot, basename(destination));
			try {
				await (
					options.copyDirectory ??
					((sourcePath, targetPath) =>
						copyDirectoryWithCow(
							sourcePath,
							targetPath,
							platform,
							options.runLinuxCommand,
						))
				)(sourcePath, temporaryDestination);
			} catch (error) {
				if (error instanceof CloneUnsupportedError) throw error;
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
			if (temporaryRoot) {
				await rm(temporaryRoot, { force: true, recursive: true }).catch(
					() => undefined,
				);
			}
			await releaseCloneLock(cloneLock).catch(() => undefined);
		}

		return cloneResult(sourcePath, startedAt, options.measureBytes);
	} finally {
		await safeParent?.close().catch(() => undefined);
	}
}

async function copyDirectoryWithCow(
	source: string,
	destination: string,
	platform: NodeJS.Platform,
	runLinuxCommand?: (command: string, args: string[]) => Promise<void>,
): Promise<void> {
	if (platform === "darwin") {
		await cp(source, destination, {
			errorOnExist: true,
			force: false,
			mode: constants.COPYFILE_FICLONE_FORCE,
			preserveTimestamps: true,
			recursive: true,
		});
		return;
	}

	const strategy = cloneStrategy(platform);
	if (!strategy) {
		throw new CloneUnsupportedError(`platform ${platform} has no CoW strategy`);
	}
	await (runLinuxCommand ?? runCloneCommand)(
		"cp",
		strategy(source, destination),
	);
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
	return error instanceof CloneUnsupportedError;
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

	return /reflink|unsupported|operation not supported|not supported|invalid cross-device|cross-device/iu.test(
		error.message,
	);
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
