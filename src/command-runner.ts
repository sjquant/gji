import { spawn } from "node:child_process";

export type CommandRunner = (
	command: string,
	cwd: string,
	stderr: (chunk: string) => void,
	stdout?: (chunk: string) => void,
	options?: CommandRunnerOptions,
) => Promise<void>;

export interface CommandRunnerOptions {
	env?: NodeJS.ProcessEnv;
	shell?: boolean;
}

export const runCommand: CommandRunner = async (
	command,
	cwd,
	stderr,
	stdout = (chunk) => process.stdout.write(chunk),
	options,
) => {
	await new Promise<void>((resolve, reject) => {
		const shell = options?.shell ?? true;
		const [executable, args] = shell ? [command, []] : splitCommand(command);
		const child = spawn(executable, args, {
			cwd,
			env: options?.env ? { ...process.env, ...options.env } : undefined,
			shell,
			stdio: ["ignore", "pipe", "pipe"],
		});

		(child.stdout as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
			stdout(chunk.toString());
		});

		(child.stderr as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
			stderr(chunk.toString());
		});

		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`exited with code ${code}`));
			} else {
				resolve();
			}
		});

		child.on("error", reject);
	});
};

function splitCommand(command: string): [string, string[]] {
	const tokens = command.match(/[^\s"']+|"[^"]*"|'[^']*'/gu) ?? [];
	const [first, ...rest] = tokens;
	if (!first) throw new Error("command must not be empty");
	return [
		first.replace(/^(["'])(.*)\1$/u, "$2"),
		rest.map((token) => token.replace(/^(["'])(.*)\1$/u, "$2")),
	];
}
