import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runGit(cwd: string, args: string[]): Promise<string> {
	return (await runGitRaw(cwd, args)).trim();
}

export async function runGitRaw(cwd: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", args, { cwd });

		return stdout;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		throw new Error(`Git command failed in '${cwd}': ${message}`);
	}
}
