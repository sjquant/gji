import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { RepositoryContext } from "../../domain/repository/context.js";
import { runGit } from "../git/runner.js";

export async function detectRepository(
	cwd: string,
): Promise<RepositoryContext> {
	const currentRoot = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
	const rawCommonDir = await runGit(cwd, ["rev-parse", "--git-common-dir"]);
	const gitCommonDir = isAbsolute(rawCommonDir)
		? rawCommonDir
		: resolve(currentRoot, rawCommonDir);
	const repoRoot = dirname(gitCommonDir);

	return {
		currentRoot,
		isWorktree: currentRoot !== repoRoot,
		repoName: basename(repoRoot),
		repoRoot,
	};
}

export async function worktreeGitDir(worktreePath: string): Promise<string> {
	const rawGitDir = await runGit(worktreePath, ["rev-parse", "--git-dir"]);
	return isAbsolute(rawGitDir) ? rawGitDir : resolve(worktreePath, rawGitDir);
}
