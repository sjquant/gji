import { lstat } from "node:fs/promises";

export async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (isNotFoundError(error)) return false;
		throw error;
	}
}

export function isAlreadyExistsError(error: unknown): boolean {
	return (
		hasErrorCode(error, "EEXIST") || hasErrorCode(error, "ERR_FS_CP_EEXIST")
	);
}

export function isNotDirectoryError(error: unknown): boolean {
	return hasErrorCode(error, "ENOTDIR");
}

export function isNotFoundError(error: unknown): boolean {
	return hasErrorCode(error, "ENOENT");
}

function hasErrorCode(error: unknown, code: string): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === code
	);
}
