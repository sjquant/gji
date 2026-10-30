import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CONTENTION_RETRY_TIMEOUT_MS = 10_000;
const CONTENTION_RETRY_MAX_DELAY_MS = 1_000;

// Force English output so error message string matching is locale-independent.
export const GIT_ENV = { ...process.env, LC_ALL: "C" };

export async function runGit(cwd: string, args: string[]): Promise<string> {
	return (await runGitRaw(cwd, args)).trim();
}

export async function runGitRaw(cwd: string, args: string[]): Promise<string> {
	return execGit(cwd, args);
}

/** Runs a Git command that can lose a race with another Git process. */
export async function runGitRetryingContention(
	cwd: string,
	args: string[],
): Promise<string> {
	return (await retryGitContention(() => execGit(cwd, args, GIT_ENV))).trim();
}

/** Retries `operation`, with jittered backoff, while Git reports contention with another process. */
export async function retryGitContention<T>(
	operation: () => Promise<T>,
	timeoutMs = CONTENTION_RETRY_TIMEOUT_MS,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (let delayMs = 25; ; delayMs *= 2) {
		try {
			return await operation();
		} catch (error) {
			if (!isTransientGitError(error) || Date.now() >= deadline) throw error;
		}
		const jitteredDelayMs =
			Math.min(delayMs, CONTENTION_RETRY_MAX_DELAY_MS) *
			(0.5 + Math.random() / 2);
		await new Promise((resolve) => setTimeout(resolve, jitteredDelayMs));
	}
}

async function execGit(
	cwd: string,
	args: string[],
	env?: NodeJS.ProcessEnv,
): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", args, { cwd, env });

		return stdout;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		throw new Error(`Git command failed in '${cwd}': ${message}`);
	}
}

// Only errors that another process can clear: a held lock, or a linked worktree
// entry that another process is still creating or removing. Git uses the
// same "cannot lock" wording for permanent failures such as a conflicting branch name.
function isTransientGitError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/(could not lock config file .*|Unable to create '.*\.lock'): File exists|cannot lock ref .*: is at .* but expected |failed to read .*\/commondir|Invalid path '.*\/worktrees\//.test(
			error.message,
		)
	);
}
