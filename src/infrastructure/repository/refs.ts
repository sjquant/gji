import { runGit } from "../git/runner.js";

export async function hasLocalBranch(
	repoRoot: string,
	branch: string,
): Promise<boolean> {
	try {
		await runGit(repoRoot, [
			"show-ref",
			"--verify",
			"--quiet",
			`refs/heads/${branch}`,
		]);
		return true;
	} catch {
		return false;
	}
}

export async function hasRemoteBranch(
	repoRoot: string,
	remote: string,
	branch: string,
): Promise<boolean> {
	try {
		await runGit(repoRoot, [
			"show-ref",
			"--verify",
			"--quiet",
			`refs/remotes/${remote}/${branch}`,
		]);
		return true;
	} catch {
		return false;
	}
}

export async function getRepositoryRemoteUrl(
	repoRoot: string,
	remote: string,
): Promise<string | null> {
	try {
		return await runGit(repoRoot, ["remote", "get-url", remote]);
	} catch {
		return null;
	}
}
