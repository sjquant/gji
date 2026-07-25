import { constants } from "node:fs";
import { copyFile, lstat, realpath } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	normalize,
	relative,
	resolve,
	sep,
} from "node:path";
import { isAlreadyExistsError, isNotFoundError } from "./fs-utils.js";
import {
	inspectDestination,
	openDestinationDirectory,
} from "./safe-destination.js";

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

		const sourcePath = await resolveSyncFileSource(mainRoot, normalized);
		if (!sourcePath) continue;
		const destPath = join(targetPath, normalized);

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
		const safeParent = await openDestinationDirectory(
			targetPath,
			destinationParent,
		);
		try {
			const safeDestination = join(safeParent.path, basename(destPath));
			const safeExistingDestination =
				await readDestinationEntry(safeDestination);
			if (safeExistingDestination?.isSymbolicLink()) {
				throw new Error(`destination is a symbolic link: ${destPath}`);
			}
			if (safeExistingDestination) continue;
			try {
				await copyFile(sourcePath, safeDestination, constants.COPYFILE_EXCL);
			} catch (error) {
				if (!isAlreadyExistsError(error)) throw error;
			}
		} finally {
			await safeParent.close().catch(() => undefined);
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

async function resolveSyncFileSource(
	mainRoot: string,
	pattern: string,
): Promise<string | undefined> {
	let resolvedRoot: string;
	let resolvedSource: string;
	try {
		[resolvedRoot, resolvedSource] = await Promise.all([
			realpath(mainRoot),
			realpath(join(mainRoot, pattern)),
		]);
	} catch (error) {
		if (isNotFoundError(error)) return undefined;
		throw error;
	}

	if (!isPathInside(resolvedRoot, resolvedSource)) {
		throw new Error(
			`syncFiles: source symlink resolves outside the repository: ${resolvedSource}`,
		);
	}

	const sourceStats = await lstat(resolvedSource);
	if (!sourceStats.isFile()) {
		throw new Error(
			`syncFiles: source is not a file: ${join(mainRoot, pattern)}`,
		);
	}
	return resolvedSource;
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

function isPathInside(root: string, candidate: string): boolean {
	const distance = relative(resolve(root), resolve(candidate));
	return (
		distance === "" ||
		(!isAbsolute(distance) &&
			distance !== ".." &&
			!distance.startsWith(`..${sep}`))
	);
}
