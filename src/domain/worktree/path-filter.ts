const GLOB_CHARACTERS = /[*?]/;

/**
 * Builds a predicate that matches worktree paths against any of the absolute
 * patterns. A pattern without glob characters matches that directory and
 * anything inside it. A pattern with `*` (within one segment), `**` (across
 * segments), or `?` (one character) must match the whole path. No patterns
 * match every path.
 */
export function createWorktreePathFilter(
	patterns: readonly string[],
): (worktreePath: string) => boolean {
	const matchers = patterns.map(createPathMatcher);
	if (matchers.length === 0) return () => true;

	return (worktreePath) => matchers.some((matches) => matches(worktreePath));
}

function createPathMatcher(pattern: string): (path: string) => boolean {
	if (GLOB_CHARACTERS.test(pattern)) {
		const regExp = globToRegExp(pattern);
		return (path) => regExp.test(path);
	}

	const prefix = pattern === "/" ? "/" : `${pattern}/`;
	return (path) => path === pattern || path.startsWith(prefix);
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
