import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { GLOBAL_CONFIG_DIRECTORY } from "./config.js";
import { isDirtyWorktree, runGit } from "./git.js";
import { detectRepository, type WorktreeEntry } from "./repo.js";

const MAX_UNDO_RECORDS = 20;
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
	const existing = await loadUndoRecords(home);
	await mkdir(dirname(undoLogPath(home)), { recursive: true });
	await writeFile(
		undoLogPath(home),
		`${JSON.stringify([record, ...existing].slice(0, MAX_UNDO_RECORDS), null, 2)}\n`,
		"utf8",
	);
	return record;
}

export async function restoreUndoRecord(
	record: UndoRecord,
	home: string = homedir(),
): Promise<UndoRestoreResult> {
	const restored: UndoEntry[] = [];
	const failed: Array<UndoEntry & { message: string }> = [];
	for (const entry of record.entries) {
		try {
			await restoreUndoEntry(record.repoRoot, entry);
			restored.push(entry);
		} catch (error) {
			failed.push({ ...entry, message: toMessage(error) });
		}
	}
	const records = await loadUndoRecords(home);
	const remaining = records.flatMap((candidate) => {
		if (candidate.id !== record.id) return [candidate];
		if (failed.length === 0) return [];
		return [
			{
				...candidate,
				entries: failed.map(({ message: _message, ...entry }) => entry),
			},
		];
	});
	await mkdir(dirname(undoLogPath(home)), { recursive: true });
	await writeFile(
		undoLogPath(home),
		`${JSON.stringify(remaining, null, 2)}\n`,
		"utf8",
	);
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
	const record = options.id
		? records.find((candidate) => candidate.id === options.id)
		: (records.find(
				(candidate) => repoRoot === null || candidate.repoRoot === repoRoot,
			) ?? records[0]);
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
): Promise<void> {
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
		await runGit(repoRoot, [
			"worktree",
			"add",
			"--detach",
			entry.path,
			entry.headSha,
		]);
		return;
	}
	let branchExists = false;
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
	} else await runGit(repoRoot, ["branch", entry.branch, entry.headSha]);
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
		try {
			await runGit(repoRoot, [
				"branch",
				"--set-upstream-to",
				entry.upstream,
				entry.branch,
			]);
		} catch {
			/* remote may be gone */
		}
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
function emitUndoError(options: UndoCommandOptions, message: string): number {
	if (options.json)
		options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
	else options.stderr(`${message}\n`);
	return 1;
}
