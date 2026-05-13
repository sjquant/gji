import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { resolveWorktreePath } from "./repo.js";

const execFileAsync = promisify(execFile);
type PullRequestForge = "bitbucket" | "github" | "gitlab";

export async function createRepository(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "gji-repo-"));
	const repoRoot = join(root, "gji-test-repo");

	await mkdir(repoRoot, { recursive: true });
	await writeFile(join(repoRoot, "README.md"), "# temp repo\n", "utf8");
	await runGit(repoRoot, ["init"]);
	await runGit(repoRoot, ["config", "user.name", "Codex"]);
	await runGit(repoRoot, ["config", "user.email", "codex@example.com"]);
	await runGit(repoRoot, ["config", "commit.gpgsign", "false"]);
	await runGit(repoRoot, ["add", "README.md"]);
	await runGit(repoRoot, ["commit", "-m", "init"]);

	return realpath(repoRoot);
}

export async function createRepositoryWithOrigin(): Promise<{
	originRoot: string;
	repoRoot: string;
}> {
	const root = await mkdtemp(join(tmpdir(), "gji-remote-"));
	const originRoot = join(root, "origin.git");
	const repoRoot = await createRepository();

	await runGit(root, ["init", "--bare", originRoot]);
	await runGit(repoRoot, ["remote", "add", "origin", originRoot]);
	await runGit(repoRoot, ["push", "-u", "origin", "HEAD"]);

	return {
		originRoot,
		repoRoot,
	};
}

export async function cloneRepository(originRoot: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "gji-clone-"));
	const cloneRoot = join(root, "clone");

	await execFileAsync("git", ["clone", originRoot, cloneRoot]);
	await runGit(cloneRoot, ["config", "user.name", "Codex"]);
	await runGit(cloneRoot, ["config", "user.email", "codex@example.com"]);
	await runGit(cloneRoot, ["config", "commit.gpgsign", "false"]);

	return realpath(cloneRoot);
}

export async function addLinkedWorktree(
	repoRoot: string,
	branch: string,
): Promise<string> {
	const worktreePath = resolveWorktreePath(repoRoot, branch);

	await runGit(repoRoot, ["branch", branch]);
	await runGit(repoRoot, ["worktree", "add", worktreePath, branch]);

	return worktreePath;
}

export async function commitFile(
	repoRoot: string,
	fileName: string,
	content: string,
	message: string,
): Promise<void> {
	await writeFile(join(repoRoot, fileName), content, "utf8");
	await runGit(repoRoot, ["add", fileName]);
	await runGit(repoRoot, ["commit", "-m", message]);
}

export async function currentBranch(cwd: string): Promise<string> {
	return runGit(cwd, ["branch", "--show-current"]);
}

export async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export async function pushPullRequestRef(
	repoRoot: string,
	number: string,
	forge: PullRequestForge = "github",
): Promise<void> {
	await runGit(repoRoot, [
		"push",
		"origin",
		`HEAD:${sourceRefForForge(number, forge)}`,
	]);
}

export async function runGit(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd });

	return stdout.trim();
}

function sourceRefForForge(number: string, forge: PullRequestForge): string {
	switch (forge) {
		case "bitbucket":
			return `refs/pull-requests/${number}/from`;
		case "github":
			return `refs/pull/${number}/head`;
		case "gitlab":
			return `refs/merge-requests/${number}/head`;
	}
}
