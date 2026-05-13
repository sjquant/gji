import { writeFile } from "node:fs/promises";

export async function writeShellOutput(
	envVar: string,
	value: string,
	stdout: (chunk: string) => void,
): Promise<void> {
	const output = `${value}\n`;

	if (process.env[envVar]) {
		await writeFile(process.env[envVar], output, "utf8");
		return;
	}

	stdout(output);
}
