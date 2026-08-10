import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export function resolveWorktreePath(
	repoRoot: string,
	branch: string,
	basePath?: string,
): string {
	const segments = branch.split("/").filter(Boolean);

	if (segments.length === 0) {
		throw new Error("Branch name must not be empty.");
	}

	if (segments.some((segment) => segment === "." || segment === "..")) {
		throw new Error(
			`Branch name '${branch}' contains an invalid path segment.`,
		);
	}

	const base = basePath
		? expandTildeInPath(basePath)
		: join(dirname(repoRoot), "worktrees", basename(repoRoot));

	return join(base, ...segments);
}

export function validateBranchName(name: string): string | null {
	if (name.length === 0) {
		return "Branch name must not be empty.";
	}
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control chars to reject in git branch names
	if (/[\x00-\x1f\x7f ~^:?*[\\\s]/.test(name)) {
		return `Branch name '${name}' contains an invalid character.`;
	}
	if (name.startsWith("-")) {
		return `Branch name '${name}' must not start with a dash.`;
	}
	if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) {
		return `Branch name '${name}' has invalid slash placement.`;
	}
	if (name.includes("..")) {
		return `Branch name '${name}' must not contain '..'.`;
	}
	if (name.endsWith(".")) {
		return `Branch name '${name}' must not end with '.'.`;
	}
	if (name.includes("@{")) {
		return `Branch name '${name}' must not contain '@{'.`;
	}
	if (name === "@") {
		return "Branch name cannot be '@'.";
	}
	for (const segment of name.split("/")) {
		if (segment.startsWith(".")) {
			return `Branch name '${name}' contains a path component starting with '.'.`;
		}
		if (segment.endsWith(".lock")) {
			return `Branch name '${name}' contains a path component ending with '.lock'.`;
		}
	}
	return null;
}

function expandTildeInPath(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}
