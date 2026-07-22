import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { isNotDirectoryError, isNotFoundError } from "./fs-utils.js";

export type DestinationInspection =
	| { kind: "missing" }
	| { kind: "exists" }
	| { kind: "unsafe"; reason: string };

export async function inspectDestination(
	root: string,
	path: string,
): Promise<DestinationInspection> {
	const resolvedPath = resolve(path);
	const resolvedRoot = resolve(root);
	const distance = relative(resolvedRoot, resolvedPath);
	if (
		isAbsolute(distance) ||
		distance === ".." ||
		distance.startsWith(`..${sep}`)
	) {
		return { kind: "unsafe", reason: "destination escapes the worktree" };
	}

	let current = resolvedRoot;
	try {
		const rootStats = await lstat(current);
		if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
			return { kind: "unsafe", reason: "worktree root is not a directory" };
		}
	} catch (error) {
		if (isNotFoundError(error)) return { kind: "missing" };
		throw error;
	}
	const segments = distance.split(sep).filter(Boolean);
	for (const [index, segment] of segments.entries()) {
		current = resolve(current, segment);
		try {
			const stats = await lstat(current);
			if (stats.isSymbolicLink()) {
				return {
					kind: "unsafe",
					reason: `destination has a symbolic-link component: ${current}`,
				};
			}
			if (index < segments.length - 1 && !stats.isDirectory()) {
				return {
					kind: "unsafe",
					reason: `destination has a non-directory ancestor: ${current}`,
				};
			}
			if (index === segments.length - 1) {
				return stats.isDirectory()
					? { kind: "exists" }
					: {
							kind: "unsafe",
							reason: `destination is not a directory: ${current}`,
						};
			}
		} catch (error) {
			if (isNotFoundError(error)) return { kind: "missing" };
			if (isNotDirectoryError(error)) {
				return {
					kind: "unsafe",
					reason: `destination has a non-directory ancestor: ${current}`,
				};
			}
			throw error;
		}
	}

	try {
		const stats = await lstat(current);
		return stats.isDirectory()
			? { kind: "exists" }
			: { kind: "unsafe", reason: "destination is not a directory" };
	} catch (error) {
		if (isNotFoundError(error)) return { kind: "missing" };
		throw error;
	}
}
