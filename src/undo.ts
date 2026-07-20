import {
	access,
	mkdir,
	open,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";

import { GLOBAL_CONFIG_DIRECTORY } from "./config.js";
import { isDirtyWorktree, runGit } from "./git.js";
import { isHeadless } from "./headless.js";
import { detectRepository, type WorktreeEntry } from "./repo.js";

const MAX_UNDO_RECORDS = 20;
const UNDO_LOCK_STALE_AFTER_MS = 60_000;
const UNDO_LOCK_RETRY_DELAY_MS = 5;
const UNDO_LOCK_WAIT_TIMEOUT_MS =
	UNDO_LOCK_STALE_AFTER_MS + UNDO_LOCK_RETRY_DELAY_MS;
const undoLogQueues = new Map<string, Promise<void>>();
export type UndoOperation = "remove" | "clean" | "done";
export interface UndoEntry {
	branch: string | null;
	headSha: string;
	path: string;
	upstream: string | null;
	wasDirty: boolean;
}
export interface UndoRecord {
	id: string;
	op: UndoOperation;
	repoRoot: string;
	timestamp: number;
	entries: UndoEntry[];
}
export interface UndoRestoreResult {
	restored: UndoEntry[];
	failed: Array<UndoEntry & { message: string }>;
}
export interface UndoCommandOptions {
	cwd: string;
	id?: string;
	list?: boolean;
	json?: boolean;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export function undoLogPath(home: string = homedir()): string {
	const configured = process.env.GJI_CONFIG_DIR;
	return join(
		configured ? resolve(configured) : join(home, GLOBAL_CONFIG_DIRECTORY),
		"undo-log.json",
	);
}

export async function loadUndoRecords(
	home: string = homedir(),
): Promise<UndoRecord[]> {
	try {
		const parsed = JSON.parse(
			await readFile(undoLogPath(home), "utf8"),
		) as unknown;
		return Array.isArray(parsed) ? parsed.filter(isUndoRecord) : [];
	} catch {
		return [];
	}
}

export async function recordUndoOperation(
	op: UndoOperation,
	repoRoot: string,
	worktrees: WorktreeEntry[],
	home: string = homedir(),
): Promise<UndoRecord | null> {
	const entries: UndoEntry[] = [];
	for (const worktree of worktrees) {
		try {
			const headSha = await runGit(worktree.path, ["rev-parse", "HEAD"]);
			let upstream: string | null = null;
			try {
				upstream = await runGit(worktree.path, [
					"rev-parse",
					"--abbrev-ref",
					"--symbolic-full-name",
					"@{u}",
				]);
			} catch {
				/* no upstream */
			}
			entries.push({
				branch: worktree.branch,
				headSha,
				path: worktree.path,
				upstream,
				wasDirty: await isDirtyWorktree(worktree.path).catch(() => false),
			});
		} catch {
			/* candidate disappeared before the destructive operation */
		}
	}
	if (entries.length === 0) return null;
	const timestamp = Date.now();
	const record: UndoRecord = {
		id: `u-${formatTimestamp(timestamp)}-${Math.random().toString(36).slice(2, 6)}`,
		op,
		repoRoot,
		timestamp,
		entries,
	};
	return enqueueUndoLogWrite(home, async () => {
		const existing = await loadUndoRecords(home);
		await writeUndoRecords(
			home,
			[record, ...existing].slice(0, MAX_UNDO_RECORDS),
		);
		return record;
	});
}

export async function finalizeUndoOperation(
	record: UndoRecord,
	removedWorktrees: WorktreeEntry[],
	home: string = homedir(),
): Promise<void> {
	const removedPaths = new Set(
		removedWorktrees.map((worktree) => worktree.path),
	);
	await enqueueUndoLogWrite(home, async () => {
		const records = await loadUndoRecords(home);
		const remaining = records.flatMap((candidate) => {
			if (candidate.id !== record.id) return [candidate];
			const entries = candidate.entries.filter((entry) =>
				removedPaths.has(entry.path),
			);
			return entries.length === 0 ? [] : [{ ...candidate, entries }];
		});
		await writeUndoRecords(home, remaining);
	});
}

export async function restoreUndoRecord(
	record: UndoRecord,
	home: string = homedir(),
): Promise<UndoRestoreResult> {
	const restored: UndoEntry[] = [];
	const failed: Array<UndoEntry & { message: string }> = [];
	const unresolved: UndoEntry[] = [];
	for (const entry of record.entries) {
		try {
			const upstreamFailure = await restoreUndoEntry(record.repoRoot, entry);
			restored.push(entry);
			if (upstreamFailure) {
				failed.push({ ...entry, message: upstreamFailure });
				unresolved.push(entry);
			}
		} catch (error) {
			failed.push({ ...entry, message: toMessage(error) });
			unresolved.push(entry);
		}
	}
	await enqueueUndoLogWrite(home, async () => {
		const records = await loadUndoRecords(home);
		const remaining = records.flatMap((candidate) => {
			if (candidate.id !== record.id) return [candidate];
			if (unresolved.length === 0) return [];
			return [{ ...candidate, entries: unresolved }];
		});
		await writeUndoRecords(home, remaining);
	});
	return { restored, failed };
}

export async function runUndoCommand(
	options: UndoCommandOptions,
): Promise<number> {
	if (await hasMalformedUndoLog())
		options.stderr(
			"Warning: undo journal is invalid; starting with an empty journal\n",
		);
	const records = await loadUndoRecords();
	if (options.list) {
		if (options.json) options.stdout(`${JSON.stringify(records, null, 2)}\n`);
		else if (records.length === 0) options.stdout("nothing to undo\n");
		else
			for (const record of records)
				options.stdout(
					`${record.id} ${record.op} ${record.entries.length} worktree${record.entries.length === 1 ? "" : "s"} ${new Date(record.timestamp).toISOString()}\n`,
				);
		return 0;
	}
	if (records.length === 0) {
		if (options.json)
			options.stdout(
				`${JSON.stringify({ restored: [], failed: [] }, null, 2)}\n`,
			);
		else options.stdout("nothing to undo\n");
		return 0;
	}
	let repoRoot: string | null = null;
	try {
		repoRoot = (await detectRepository(options.cwd)).repoRoot;
	} catch {
		/* use latest globally */
	}
	let record: UndoRecord | undefined;
	if (options.id) {
		record = records.find((candidate) => candidate.id === options.id);
	} else if (repoRoot !== null && records[0]?.repoRoot !== repoRoot) {
		const latest = records[0];
		const message = `latest undo record belongs to ${latest.repoRoot}; use --id to select it`;
		if (options.json || isHeadless()) return emitUndoError(options, message);
		const choice = await confirm({
			message: `${message}. Restore it anyway?`,
			active: "Yes",
			inactive: "No",
			initialValue: false,
		});
		if (isCancel(choice) || !choice) return emitUndoError(options, "Aborted");
		record = latest;
	} else {
		record = repoRoot
			? records.find((candidate) => candidate.repoRoot === repoRoot)
			: records[0];
	}
	if (!record)
		return emitUndoError(options, `undo record not found: ${options.id}`);
	const result = await restoreUndoRecord(record);
	if (options.json)
		options.stdout(
			`${JSON.stringify({ restored: result.restored.map((entry) => ({ branch: entry.branch, path: entry.path })), failed: result.failed.map((entry) => ({ branch: entry.branch, path: entry.path, error: entry.message })) }, null, 2)}\n`,
		);
	else {
		for (const entry of result.restored) {
			options.stdout(
				`✓ restored ${entry.branch ?? "detached worktree"} at ${entry.path}\n`,
			);
			if (entry.wasDirty)
				options.stderr(
					"note: uncommitted changes at deletion time were not preserved\n",
				);
		}
		for (const entry of result.failed)
			options.stderr(
				`Failed to restore ${entry.branch ?? entry.path}: ${entry.message}\n`,
			);
	}
	return result.failed.length === 0 ? 0 : 1;
}

async function hasMalformedUndoLog(): Promise<boolean> {
	try {
		const parsed = JSON.parse(await readFile(undoLogPath(), "utf8")) as unknown;
		return (
			!Array.isArray(parsed) || parsed.some((entry) => !isUndoRecord(entry))
		);
	} catch (error) {
		return (
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code !== "ENOENT"
		);
	}
}

async function restoreUndoEntry(
	repoRoot: string,
	entry: UndoEntry,
): Promise<string | null> {
	try {
		await access(entry.path);
		throw new Error(`path already exists: ${entry.path}`);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.startsWith("path already exists:")
		)
			throw error;
	}
	if (entry.branch === null) {
		await assertCommitExists(repoRoot, entry.headSha);
		await runGit(repoRoot, [
			"worktree",
			"add",
			"--detach",
			entry.path,
			entry.headSha,
		]);
		return null;
	}
	let branchExists = false;
	let existingUpstream: string | null = null;
	try {
		await runGit(repoRoot, [
			"show-ref",
			"--verify",
			`refs/heads/${entry.branch}`,
		]);
		branchExists = true;
	} catch {
		/* branch was deleted */
	}
	if (branchExists) {
		const currentSha = await runGit(repoRoot, ["rev-parse", entry.branch]);
		if (currentSha !== entry.headSha)
			throw new Error(
				`branch ${entry.branch} already exists at a different commit`,
			);
		existingUpstream = await runGit(repoRoot, [
			"rev-parse",
			"--abbrev-ref",
			"--symbolic-full-name",
			`${entry.branch}@{u}`,
		]).catch(() => null);
		if (
			entry.upstream &&
			existingUpstream &&
			existingUpstream !== entry.upstream
		)
			throw new Error(
				`branch ${entry.branch} already tracks ${existingUpstream}; refusing to overwrite it`,
			);
	} else {
		await assertCommitExists(repoRoot, entry.headSha);
		await runGit(repoRoot, ["branch", entry.branch, entry.headSha]);
	}
	try {
		await runGit(repoRoot, ["worktree", "add", entry.path, entry.branch]);
	} catch (error) {
		if (!branchExists) {
			try {
				await runGit(repoRoot, ["branch", "-D", entry.branch]);
			} catch {
				/* best effort */
			}
		}
		throw error;
	}
	if (entry.upstream) {
		if (existingUpstream === entry.upstream) return null;
		try {
			await runGit(repoRoot, [
				"branch",
				"--set-upstream-to",
				entry.upstream,
				entry.branch,
			]);
		} catch (error) {
			return `could not restore upstream ${entry.upstream}: ${toRestoreMessage(error)}`;
		}
	}
	return null;
}

async function assertCommitExists(
	repoRoot: string,
	headSha: string,
): Promise<void> {
	try {
		await runGit(repoRoot, ["cat-file", "-e", `${headSha}^{commit}`]);
	} catch {
		throw new Error("commit no longer exists (gc'd) — cannot restore");
	}
}

async function enqueueUndoLogWrite<T>(
	home: string,
	operation: () => Promise<T>,
): Promise<T> {
	const path = undoLogPath(home);
	await mkdir(dirname(path), { recursive: true });
	const previous = undoLogQueues.get(path) ?? Promise.resolve();
	const runLocked = async (): Promise<T> => {
		const release = await acquireUndoLogLock(path);
		try {
			return await operation();
		} finally {
			await release();
		}
	};
	const current = previous.then(runLocked, runLocked);
	const settled = current.then(
		() => undefined,
		() => undefined,
	);
	undoLogQueues.set(path, settled);
	try {
		return await current;
	} finally {
		if (undoLogQueues.get(path) === settled) undoLogQueues.delete(path);
	}
}

async function acquireUndoLogLock(path: string): Promise<() => Promise<void>> {
	const lockPath = `${path}.lock`;
	const deadline = Date.now() + UNDO_LOCK_WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const handle = await open(lockPath, "wx");
			return async () => {
				await handle.close();
				await unlink(lockPath).catch(() => undefined);
			};
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "EEXIST")
			)
				throw error;
			const lockStat = await stat(lockPath).catch(() => null);
			if (lockStat && Date.now() - lockStat.mtimeMs > UNDO_LOCK_STALE_AFTER_MS)
				await unlink(lockPath).catch(() => undefined);
			const remainingMs = deadline - Date.now();
			if (remainingMs > 0)
				await new Promise((resolve) =>
					setTimeout(resolve, Math.min(UNDO_LOCK_RETRY_DELAY_MS, remainingMs)),
				);
		}
	}
	throw new Error("timed out waiting for the undo journal lock");
}

async function writeUndoRecords(
	home: string,
	records: UndoRecord[],
): Promise<void> {
	const path = undoLogPath(home);
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, {
			encoding: "utf8",
			flag: "wx",
		});
		await rename(temporaryPath, path);
	} finally {
		await unlink(temporaryPath).catch(() => undefined);
	}
}

function isUndoRecord(value: unknown): value is UndoRecord {
	if (!value || typeof value !== "object") return false;
	const c = value as Partial<UndoRecord>;
	return (
		typeof c.id === "string" &&
		(c.op === "remove" || c.op === "clean" || c.op === "done") &&
		typeof c.repoRoot === "string" &&
		typeof c.timestamp === "number" &&
		Array.isArray(c.entries) &&
		c.entries.every(isUndoEntry)
	);
}
function isUndoEntry(value: unknown): value is UndoEntry {
	if (!value || typeof value !== "object") return false;
	const c = value as Partial<UndoEntry>;
	return (
		(c.branch === null || typeof c.branch === "string") &&
		typeof c.headSha === "string" &&
		typeof c.path === "string" &&
		(c.upstream === null || typeof c.upstream === "string") &&
		typeof c.wasDirty === "boolean"
	);
}
function formatTimestamp(timestamp: number): string {
	return new Date(timestamp)
		.toISOString()
		.replace(/[-:TZ.]/g, "")
		.slice(0, 12);
}
function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function toRestoreMessage(error: unknown): string {
	const message = toMessage(error);
	return /bad object|unknown revision|not a valid object name/i.test(message)
		? "commit no longer exists (gc'd) — cannot restore"
		: message;
}
function emitUndoError(options: UndoCommandOptions, message: string): number {
	if (options.json)
		options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
	else options.stderr(`${message}\n`);
	return 1;
}
