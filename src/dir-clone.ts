import { execFile } from "node:child_process";
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
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { GLOBAL_CONFIG_DIRECTORY } from "./config.js";

const execFileAsync = promisify(execFile);
const STATE_FILE_NAME = "state.json";

interface CloneFailure {
	failedAt: number;
	reason: string;
}

const CLONE_FAILURE_TTL_MS = 24 * 60 * 60 * 1000;
const CLONE_LOCK_TTL_MS = 24 * 60 * 60 * 1000;
const CLONE_LOCK_SUFFIX = ".gji-clone-lock";

interface GjiState {
	[key: string]: unknown;
	syncDirs?: Record<string, Record<string, CloneFailure>>;
}

export interface CloneDirResult {
	bytes: number;
	ms: number;
}

export interface CloneDirOptions {
	platform?: NodeJS.Platform;
	runCommand?: (command: string, args: string[]) => Promise<void>;
	copyDirectory?: (source: string, destination: string) => Promise<void>;
}

export type CloneDirectory = (
	source: string,
	destination: string,
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
	await acquireCloneLock(lockPath, destination);

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

		if (await pathExists(destination)) {
			throw new CloneDestinationExistsError(destination);
		}

		await rename(temporaryDestination, destination);
	} finally {
		if (temporaryRoot) {
			await rm(temporaryRoot, { force: true, recursive: true });
		}
		await rm(lockPath, { force: true, recursive: true });
	}

	const bytes = await estimateCloneBytes(sourcePath);
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

export async function isCloneFailureCached(
	repoRoot: string,
	directory: string,
): Promise<boolean> {
	const state = await readState();
	const repoState = state.syncDirs?.[repoRoot];
	if (!repoState || !Object.hasOwn(repoState, directory)) return false;

	const failure = repoState[directory];
	return (
		isPlainObject(failure) &&
		typeof failure.failedAt === "number" &&
		Date.now() - failure.failedAt < CLONE_FAILURE_TTL_MS
	);
}

export async function cacheCloneFailure(
	repoRoot: string,
	directory: string,
	reason: string,
): Promise<void> {
	const state = await readState();
	const syncDirs = state.syncDirs ?? {};
	const repoState = syncDirs[repoRoot] ?? {};

	syncDirs[repoRoot] = {
		...repoState,
		[directory]: { failedAt: Date.now(), reason },
	};

	await writeState({ ...state, syncDirs });
}

export async function clearCloneFailure(
	repoRoot: string,
	directory: string,
): Promise<void> {
	const state = await readState();
	const repoState = state.syncDirs?.[repoRoot];
	if (!repoState || !Object.hasOwn(repoState, directory)) return;

	const nextRepoState = { ...repoState };
	delete nextRepoState[directory];
	const syncDirs = { ...state.syncDirs };
	if (Object.keys(nextRepoState).length === 0) delete syncDirs[repoRoot];
	else syncDirs[repoRoot] = nextRepoState;

	await writeState({ ...state, syncDirs });
}

export async function directorySize(path: string): Promise<number> {
	const stats = await lstat(path);
	if (!stats.isDirectory()) return stats.size;

	const entries = await readdir(path, { withFileTypes: true });
	let total = 0;
	for (const entry of entries) {
		total += await directorySize(join(path, entry.name));
	}

	return total;
}

export function cloneStrategy(
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

export function isClonePlatformSupported(platform: NodeJS.Platform): boolean {
	return platform === "darwin" || platform === "linux";
}

async function estimateCloneBytes(path: string): Promise<number> {
	try {
		return await directorySize(path);
	} catch {
		return 0;
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

async function readState(): Promise<GjiState> {
	try {
		const raw = await readFile(stateFilePath(), "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!isPlainObject(parsed)) return {};
		return isPlainObject(parsed.syncDirs)
			? (parsed as GjiState)
			: { ...parsed, syncDirs: {} };
	} catch {
		return {};
	}
}

async function writeState(state: GjiState): Promise<void> {
	try {
		const path = stateFilePath();
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	} catch {
		// The failure cache is advisory and must never block worktree creation.
	}
}

function stateFilePath(home: string = homedir()): string {
	const configuredDirectory = process.env.GJI_CONFIG_DIR;
	const directory = configuredDirectory
		? resolve(configuredDirectory)
		: join(home, GLOBAL_CONFIG_DIRECTORY);

	return join(directory, STATE_FILE_NAME);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (isNotFoundError(error)) return false;
		throw error;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

function isAlreadyExistsError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "EEXIST"
	);
}

async function acquireCloneLock(
	lockPath: string,
	destination: string,
): Promise<void> {
	try {
		await mkdir(lockPath);
		return;
	} catch (error) {
		if (!isAlreadyExistsError(error)) throw error;
	}

	try {
		const lockStats = await lstat(lockPath);
		if (Date.now() - lockStats.mtimeMs >= CLONE_LOCK_TTL_MS) {
			await rm(lockPath, { force: true, recursive: true });
			await mkdir(lockPath);
			return;
		}
	} catch (error) {
		if (!isNotFoundError(error)) throw error;
	}

	throw new CloneDestinationExistsError(destination);
}

function isUnsupportedCloneError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;

	const code = "code" in error ? (error as NodeJS.ErrnoException).code : "";
	if (
		["EINVAL", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(code ?? "")
	) {
		return true;
	}

	return /clonefile|reflink|unsupported|operation not supported|not supported/iu.test(
		error.message,
	);
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function platformIsDarwin(platform: NodeJS.Platform): boolean {
	return platform === "darwin";
}
