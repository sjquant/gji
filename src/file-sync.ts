import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";

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

		// Skip silently if target already exists
		const destExists = await fileExists(destPath);
		if (destExists) {
			continue;
		}

		await mkdir(dirname(destPath), { recursive: true });
		await copyFile(sourcePath, destPath);
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

function isNotFoundError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}
