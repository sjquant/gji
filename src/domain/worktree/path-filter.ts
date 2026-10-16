import { resolve } from "node:path";

import { expandTildeInPath } from "./policy.js";

const GLOB_CHARACTERS = /[*?]/;

export function resolvePathPattern(cwd: string, pattern: string): string {
	return resolve(cwd, expandTildeInPath(pattern));
}

/**
 * Matches a worktree path against absolute path patterns.
 *
 * A pattern without glob characters matches that directory and anything
 * inside it. A pattern with `*` (within one segment), `**` (across segments),
 * or `?` (one character) must match the whole path.
 */
export function matchesPathPatterns(
	worktreePath: string,
	patterns: readonly string[],
): boolean {
	if (patterns.length === 0) return true;

	const path = trimTrailingSeparators(worktreePath);
	return patterns.some((pattern) => matchesPathPattern(path, pattern));
}

function matchesPathPattern(path: string, pattern: string): boolean {
	const normalizedPattern = trimTrailingSeparators(pattern);

	if (!GLOB_CHARACTERS.test(normalizedPattern)) {
		return (
			path === normalizedPattern ||
			path.startsWith(`${normalizedPattern === "/" ? "" : normalizedPattern}/`)
		);
	}

	return globToRegExp(normalizedPattern).test(path);
}

function globToRegExp(pattern: string): RegExp {
	let source = "";

	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index];
		if (character === "*") {
			if (pattern[index + 1] === "*") {
				index += 1;
				if (pattern[index + 1] === "/") {
					index += 1;
					source += "(?:.*/)?";
				} else {
					source += ".*";
				}
			} else {
				source += "[^/]*";
			}
		} else if (character === "?") {
			source += "[^/]";
		} else {
			source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
		}
	}

	return new RegExp(`^${source}$`);
}

function trimTrailingSeparators(path: string): string {
	return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}
