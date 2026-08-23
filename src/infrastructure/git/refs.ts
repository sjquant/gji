import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RemoteBase } from "../../ports/git.js";
import { runGit } from "./runner.js";

export type { RemoteBase } from "../../ports/git.js";

const execFileAsync = promisify(execFile);

export async function isBranchMergedInto(
	cwd: string,
	branch: string,
	base = "HEAD",
): Promise<boolean> {
	try {
		await execFileAsync("git", ["merge-base", "--is-ancestor", branch, base], {
			cwd,
		});

		return true;
	} catch (error) {
		if (hasExitCode(error, 1)) {
			return false;
		}

		throw error;
	}
}

export async function resolveRemoteDefaultBranch(
	cwd: string,
	remote: string,
): Promise<string | null> {
	const { stdout } = await execFileAsync(
		"git",
		["ls-remote", "--symref", remote, "HEAD"],
		{ cwd },
	);
	const refLine = stdout
		.split("\n")
		.find((line) => line.startsWith("ref: refs/heads/"));

	if (!refLine) {
		return null;
	}

	const match = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(refLine);

	return match?.[1] ?? null;
}

export async function resolveRemoteBase(
	cwd: string,
	remote: string,
	configuredBranch?: string,
): Promise<RemoteBase | null> {
	try {
		await runGit(cwd, ["remote", "get-url", remote]);
	} catch {
		return null;
	}
	let branch = configuredBranch;
	if (!branch) {
		try {
			const discoveredBranch = await resolveRemoteDefaultBranch(cwd, remote);
			branch =
				discoveredBranch ??
				(await resolveCachedRemoteDefaultBranch(cwd, remote));
		} catch {
			branch = await resolveCachedRemoteDefaultBranch(cwd, remote);
		}
	}

	if (!branch) return null;

	return {
		branch,
		ref: `${remote}/${branch}`,
	};
}

async function resolveCachedRemoteDefaultBranch(
	cwd: string,
	remote: string,
): Promise<string | undefined> {
	try {
		const ref = await runGit(cwd, [
			"symbolic-ref",
			"--short",
			`refs/remotes/${remote}/HEAD`,
		]);
		const prefix = `${remote}/`;
		return ref.startsWith(prefix) ? ref.slice(prefix.length) : undefined;
	} catch {
		try {
			const refs = await runGit(cwd, [
				"for-each-ref",
				"--format=%(refname:strip=3)",
				`refs/remotes/${remote}`,
			]);
			return refs.split("\n").find((ref) => ref !== "HEAD");
		} catch {
			return undefined;
		}
	}
}

export async function readBranchLastCommitTimestamp(
	cwd: string,
	branch: string,
): Promise<number | null> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["log", "-1", "--format=%ct", branch],
			{ cwd },
		);
		const timestamp = Number(stdout.trim());

		return Number.isFinite(timestamp) ? timestamp : null;
	} catch {
		return null;
	}
}

function hasExitCode(error: unknown, code: number): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as { code: unknown }).code === code
	);
}
