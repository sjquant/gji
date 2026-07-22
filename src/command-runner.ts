import { spawn } from "node:child_process";

export type CommandRunner = (
	command: string,
	cwd: string,
	stderr: (chunk: string) => void,
	stdout?: (chunk: string) => void,
) => Promise<void>;

export const runCommand: CommandRunner = async (
	command,
	cwd,
	stderr,
	stdout = (chunk) => process.stdout.write(chunk),
) => {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, {
			cwd,
			shell: true,
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
