import { spawn } from "node:child_process";

export interface EditorDefinition {
	cli: string;
	name: string;
	newWindowFlag?: string;
	supportsWorkspace: boolean;
}

// Ordered by likely popularity among the target audience.
export const EDITORS: EditorDefinition[] = [
	{
		cli: "cursor",
		name: "Cursor",
		newWindowFlag: "--new-window",
		supportsWorkspace: true,
	},
	{
		cli: "code",
		name: "VS Code",
		newWindowFlag: "--new-window",
		supportsWorkspace: true,
	},
	{
		cli: "windsurf",
		name: "Windsurf",
		newWindowFlag: "--new-window",
		supportsWorkspace: true,
	},
	{ cli: "zed", name: "Zed", supportsWorkspace: false },
	{
		cli: "subl",
		name: "Sublime Text",
		newWindowFlag: "--new-window",
		supportsWorkspace: false,
	},
];

export async function defaultSpawnEditor(
	cli: string,
	args: string[],
): Promise<void> {
	const child = spawn(cli, args, { detached: true, stdio: "ignore" });

	await new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.once("spawn", resolve);
	});

	child.unref();
}
