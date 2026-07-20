import { execFile } from "node:child_process";
import {
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
	const strategy = cloneStrategy(options.platform ?? process.platform);
	if (!strategy) {
		throw new Error(
			`copy-on-write cloning is not supported on ${options.platform ?? process.platform}`,
		);
	}

	const sourcePath = await realpath(source);
	const sourceStats = await lstat(sourcePath);
	if (!sourceStats.isDirectory()) {
		throw new Error("source is not a directory");
	}
	if (await pathExists(destination)) {
		throw new CloneDestinationExistsError(destination);
	}

	const bytes = await directorySize(sourcePath);
	const startedAt = Date.now();
	const parent = dirname(destination);
	await mkdir(parent, { recursive: true });
	const temporaryRoot = await mkdtemp(
		join(parent, `.${basename(destination)}.gji-clone-`),
	);
	const temporaryDestination = join(temporaryRoot, basename(destination));

	try {
		const runCommand = options.runCommand ?? runCloneCommand;
		await runCommand("cp", strategy(sourcePath, temporaryDestination));

		if (await pathExists(destination)) {
			throw new CloneDestinationExistsError(destination);
		}

		await rename(temporaryDestination, destination);
	} finally {
		await rm(temporaryRoot, { force: true, recursive: true });
	}

	return { bytes, ms: Date.now() - startedAt };
}

export class CloneDestinationExistsError extends Error {
	readonly code = "GJI_CLONE_DESTINATION_EXISTS";

	constructor(destination: string) {
		super(`destination already exists: ${destination}`);
		this.name = "CloneDestinationExistsError";
	}
}

export function isCloneDestinationExistsError(
	error: unknown,
): error is CloneDestinationExistsError {
	return error instanceof CloneDestinationExistsError;
}

export async function isCloneFailureCached(
	repoRoot: string,
	directory: string,
): Promise<boolean> {
	const state = await readState();
	const repoState = state.syncDirs?.[repoRoot];
	return repoState?.[directory] !== undefined;
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
	if (!repoState?.[directory]) return;

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
	if (platform === "darwin") {
		return (source, destination) => ["-Rc", source, destination];
	}

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

async function runCloneCommand(command: string, args: string[]): Promise<void> {
	await execFileAsync(command, args);
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
