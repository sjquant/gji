import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
	isAlreadyExistsError,
	isNotDirectoryError,
	isNotFoundError,
} from "./fs-utils.js";

export type DestinationInspection =
	| { kind: "missing" }
	| { kind: "exists" }
	| { kind: "unsafe"; reason: string };

export interface OpenDestinationDirectory {
	path: string;
	close(): Promise<void>;
}

export async function openDestinationDirectory(
	root: string,
	path: string,
): Promise<OpenDestinationDirectory> {
	const segments = destinationSegments(root, path);
	if (process.platform !== "linux") {
		await ensureDestinationDirectory(root, path);
		return { path: resolve(path), close: async () => undefined };
	}
	let handle = await open(root, destinationDirectoryFlags());

	try {
		for (const segment of segments) {
			const childPath = join(fileDescriptorPath(handle.fd), segment);
			try {
				await mkdir(childPath);
			} catch (error) {
				if (!isAlreadyExistsError(error)) throw error;
			}

			const childHandle = await open(childPath, destinationDirectoryFlags());
			await handle.close();
			handle = childHandle;
		}

		return {
			path: fileDescriptorPath(handle.fd),
			close: async () => handle.close(),
		};
	} catch (error) {
		await handle.close().catch(() => undefined);
		throw error;
	}
}

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

function destinationSegments(root: string, path: string): string[] {
	const resolvedRoot = resolve(root);
	const resolvedPath = resolve(path);
	const distance = relative(resolvedRoot, resolvedPath);
	if (
		isAbsolute(distance) ||
		distance === ".." ||
		distance.startsWith(`..${sep}`)
	) {
		throw new Error("destination escapes the worktree");
	}

	return distance.split(sep).filter(Boolean);
}

function destinationDirectoryFlags(): number {
	return constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
}

function fileDescriptorPath(fd: number): string {
	if (process.platform === "linux") return `/proc/self/fd/${fd}`;
	if (process.platform === "darwin") return `/dev/fd/${fd}`;
	throw new Error(
		`safe destination handles are unsupported on ${process.platform}`,
	);
}

export async function ensureDestinationDirectory(
	root: string,
	path: string,
): Promise<void> {
	const resolvedRoot = resolve(root);
	const resolvedPath = resolve(path);
	const distance = relative(resolvedRoot, resolvedPath);
	if (
		isAbsolute(distance) ||
		distance === ".." ||
		distance.startsWith(`..${sep}`)
	) {
		throw new Error("destination escapes the worktree");
	}

	let current = resolvedRoot;
	const rootStats = await lstat(current);
	if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
		throw new Error("worktree root is not a directory");
	}

	for (const segment of distance.split(sep).filter(Boolean)) {
		current = resolve(current, segment);
		try {
			const stats = await lstat(current);
			if (stats.isSymbolicLink() || !stats.isDirectory()) {
				throw new Error(`destination has an unsafe component: ${current}`);
			}
		} catch (error) {
			if (!isNotFoundError(error)) throw error;
			try {
				await mkdir(current);
			} catch (mkdirError) {
				if (!isAlreadyExistsError(mkdirError)) throw mkdirError;
			}
			const stats = await lstat(current);
			if (stats.isSymbolicLink() || !stats.isDirectory()) {
				throw new Error(`destination has an unsafe component: ${current}`);
			}
		}
	}
}
