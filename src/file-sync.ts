import { constants } from "node:fs";
import { copyFile, lstat, mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";

import { inspectDestination } from "./safe-destination.js";

/**
 * Copies files matching each pattern (relative to mainRoot) into the equivalent
 * relative path under targetPath, creating parent directories as needed.
 *
 * - Non-destructive: silently skips if the target file already exists.
 * - Silently skips if the source file does not exist.
 * - Rejects patterns that are absolute paths or contain `..` segments.
 */
export async function syncFiles(
	mainRoot: string,
	targetPath: string,
	patterns: string[],
): Promise<void> {
	for (const pattern of patterns) {
		const normalized = validateSyncFilePattern(pattern);

		const sourcePath = join(mainRoot, normalized);
		const destPath = join(targetPath, normalized);

		// Skip silently if source does not exist
		const sourceExists = await fileExists(sourcePath);
		if (!sourceExists) {
			continue;
		}

		// Skip ordinary existing targets, but fail closed on any symlink.
		const existingDestination = await readDestinationEntry(destPath);
		if (existingDestination?.isSymbolicLink()) {
			throw new Error(`destination is a symbolic link: ${destPath}`);
		}
		if (existingDestination) {
			continue;
		}

		const destinationParent = dirname(destPath);
		const beforeCreate = await inspectDestination(
			targetPath,
			destinationParent,
		);
		if (beforeCreate.kind === "unsafe") {
			throw new Error(beforeCreate.reason);
		}
		await mkdir(destinationParent, { recursive: true });
		const afterCreate = await inspectDestination(targetPath, destinationParent);
		if (afterCreate.kind === "unsafe") {
			throw new Error(afterCreate.reason);
		}
		try {
			await copyFile(sourcePath, destPath, constants.COPYFILE_EXCL);
		} catch (error) {
			if (!isAlreadyExistsError(error)) throw error;
		}
	}
}

export function validateSyncFilePattern(pattern: string): string {
	if (isAbsolute(pattern)) {
		throw new Error(
			`syncFiles: pattern must be a relative path, got: ${pattern}`,
		);
	}

	const normalized = normalize(pattern);
	if (normalized.startsWith("..")) {
		throw new Error(
			`syncFiles: pattern must not contain '..' segments, got: ${pattern}`,
		);
	}

	return normalized;
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isNotFoundError(error)) {
			return false;
		}
		throw error;
	}
}

async function readDestinationEntry(
	path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
	try {
		return await lstat(path);
	} catch (error) {
		if (isNotFoundError(error)) return undefined;
		throw error;
	}
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
