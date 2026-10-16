/**
 * Builds a predicate that matches worktree paths against any of the absolute
 * patterns. A pattern without glob characters matches that directory and
 * anything inside it. A pattern with `*` (within one segment), `**` (across
 * segments), or `?` (one character) must match the whole path. A backslash
 * makes the next character literal, so `\*` and `\?` match themselves. No
 * patterns match every path.
 */
export function createWorktreePathFilter(
	patterns: readonly string[],
): (worktreePath: string) => boolean {
	const matchers = patterns.map(createPathMatcher);
	if (matchers.length === 0) return () => true;

	return (worktreePath) => matchers.some((matches) => matches(worktreePath));
}

/** Returns the index of the first unescaped glob character, or -1. */
export function findGlobIndex(pattern: string): number {
	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index];
		if (character === "\\") index += 1;
		else if (character === "*" || character === "?") return index;
	}

	return -1;
}

export function escapePathPattern(path: string): string {
	return path.replace(/[\\*?]/g, "\\$&");
}

export function unescapePathPattern(pattern: string): string {
	return pattern.replace(/\\(.)/g, "$1");
}

function createPathMatcher(pattern: string): (path: string) => boolean {
	if (findGlobIndex(pattern) !== -1) {
		const regExp = globToRegExp(pattern);
		return (path) => regExp.test(path);
	}

	const literal = unescapePathPattern(pattern);
	const prefix = literal === "/" ? "/" : `${literal}/`;
	return (path) => path === literal || path.startsWith(prefix);
}

function globToRegExp(pattern: string): RegExp {
	let source = "";

	for (let index = 0; index < pattern.length; index += 1) {
		let character = pattern[index];
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
			if (character === "\\" && index + 1 < pattern.length) {
				index += 1;
				character = pattern[index];
			}
			source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	}

	return new RegExp(`^${source}$`);
}
