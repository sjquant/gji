import { execFile } from "node:child_process";
import { platform } from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type BrowserCommandRunner = (
	command: string,
	args: string[],
) => Promise<void>;

export interface BrowserOpenerDependencies {
	platform?: NodeJS.Platform;
	runCommand?: BrowserCommandRunner;
}

export function createBrowserOpener(
	dependencies: BrowserOpenerDependencies = {},
): (url: string) => Promise<void> {
	const currentPlatform = dependencies.platform ?? platform;
	const runCommand = dependencies.runCommand ?? defaultRunCommand;

	return async function openBrowser(url: string): Promise<void> {
		const command = browserCommand(currentPlatform, url);
		await runCommand(command.command, command.args);
	};
}

export const openBrowser = createBrowserOpener();

function browserCommand(
	currentPlatform: NodeJS.Platform,
	url: string,
): { args: string[]; command: string } {
	if (currentPlatform === "darwin") return { args: [url], command: "open" };
	if (currentPlatform === "win32") {
		return { args: ["/c", "start", "", url], command: "cmd.exe" };
	}

	return { args: [url], command: "xdg-open" };
}

async function defaultRunCommand(
	command: string,
	args: string[],
): Promise<void> {
	await execFileAsync(command, args, { timeout: 10_000 });
}
