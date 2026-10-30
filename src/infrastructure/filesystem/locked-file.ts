import { randomUUID } from "node:crypto";
import {
	mkdir,
	open,
	rename,
	rm,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isAlreadyExistsError } from "./fs-utils.js";

const LOCK_STALE_AFTER_MS = 10_000;
const LOCK_RETRY_DELAY_MS = 5;
const LOCK_WAIT_TIMEOUT_MS = LOCK_STALE_AFTER_MS + LOCK_RETRY_DELAY_MS;

/** Serializes read-modify-write cycles on `path` across gji processes. */
export async function withFileLock<T>(
	path: string,
	operation: () => Promise<T>,
): Promise<T> {
	await mkdir(dirname(path), { recursive: true });
	const release = await acquireFileLock(path);
	try {
		return await operation();
	} finally {
		await release();
	}
}

/** Replaces `path` in one step so concurrent readers never see a partial file. */
export async function writeJsonAtomic(
	path: string,
	value: unknown,
): Promise<void> {
	const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
	try {
		await writeFile(
			temporaryPath,
			`${JSON.stringify(value, null, 2)}\n`,
			"utf8",
		);
		await rename(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

async function acquireFileLock(path: string): Promise<() => Promise<void>> {
	const lockPath = `${path}.lock`;
	const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const handle = await open(lockPath, "wx");
			return async () => {
				await handle.close();
				await unlink(lockPath).catch(() => undefined);
			};
		} catch (error) {
			if (!isAlreadyExistsError(error)) throw error;
			const lockStat = await stat(lockPath).catch(() => null);
			if (lockStat && Date.now() - lockStat.mtimeMs > LOCK_STALE_AFTER_MS)
				await unlink(lockPath).catch(() => undefined);
			await delay(LOCK_RETRY_DELAY_MS);
		}
	}
	throw new Error(`timed out waiting for the lock on ${path}`);
}
