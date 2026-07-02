import { execFile } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { isCancel, select } from "@clack/prompts";
import {
	loadEffectiveConfig,
	resolveConfigString,
	updateGlobalConfigKey,
} from "./config.js";
import {
	defaultSpawnEditor,
	EDITORS,
	type EditorDefinition,
} from "./editor.js";
import { isHeadless } from "./headless.js";
import { recordWorktreeUsage } from "./history.js";
import { detectRepository, listWorktrees, type WorktreeEntry } from "./repo.js";
import {
	buildConfiguredWorktreePromptEntries,
	promptForSingleWorktree,
	resolveWorktreeQuery,
	type WorktreePromptEntry,
} from "./worktree-picker.js";

export type { EditorDefinition };

const execFileAsync = promisify(execFile);

export interface OpenCommandOptions {
	branch?: string;
	cwd: string;
	editor?: string;
	save?: boolean;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
	workspace?: boolean;
}

export interface OpenCommandDependencies {
	detectEditors: () => Promise<EditorDefinition[]>;
	promptForEditor: (editors: EditorDefinition[]) => Promise<string | null>;
	promptForWorktree: (
		worktrees: WorktreePromptEntry[],
	) => Promise<string | null>;
	spawnEditor: (cli: string, args: string[]) => Promise<void>;
}

export function createOpenCommand(
	dependencies: Partial<OpenCommandDependencies> = {},
): (options: OpenCommandOptions) => Promise<number> {
	const detectEditors = dependencies.detectEditors ?? detectInstalledEditors;
	const promptForEditor =
		dependencies.promptForEditor ?? defaultPromptForEditor;
	const promptForWorktree =
		dependencies.promptForWorktree ?? defaultPromptForWorktree;
	const spawnEditor = dependencies.spawnEditor ?? defaultSpawnEditor;

	return async function runOpenCommand(
		options: OpenCommandOptions,
	): Promise<number> {
		const [worktrees, repository] = await Promise.all([
			listWorktrees(options.cwd),
			detectRepository(options.cwd),
		]);

		// Resolve target worktree path.
		let targetPath: string;
		let targetWorktree: WorktreeEntry | undefined;
		if (options.branch) {
			const match = resolveWorktreeQuery(
				worktrees.map((worktree) => ({
					repoName: repository.repoName,
					worktree,
				})),
				options.branch,
			);
			if (!match) {
				options.stderr(
					`gji open: no worktree found matching: ${options.branch}\n`,
				);
				options.stderr(`Hint: Use 'gji ls' to see available worktrees\n`);
				return 1;
			}
			targetPath = match.worktree.path;
			targetWorktree = match.worktree;
		} else if (isHeadless()) {
			targetWorktree = worktrees.find((w) => w.isCurrent);
			targetPath = targetWorktree?.path ?? options.cwd;
		} else {
			const entries = await buildConfiguredWorktreePromptEntries(
				repository.repoRoot,
				worktrees.map((worktree) => ({
					repoName: repository.repoName,
					worktree,
				})),
				options.stderr,
			);
			const chosen = await promptForWorktree(entries);
			if (!chosen) {
				options.stderr("Aborted\n");
				return 1;
			}
			targetPath = chosen;
			targetWorktree = worktrees.find((w) => w.path === chosen);
		}

		// Resolve which editor to use.
		const config = await loadEffectiveConfig(
			repository.repoRoot,
			undefined,
			options.stderr,
		);
		const savedEditor = resolveConfigString(config, "editor");

		let editorCli: string;
		if (options.editor) {
			editorCli = options.editor;
		} else if (savedEditor) {
			editorCli = savedEditor;
		} else {
			const installed = await detectEditors();
			if (installed.length === 0) {
				options.stderr(
					"gji open: no supported editor detected. Use --editor <code|cursor|zed|...> to specify one.\n",
				);
				return 1;
			}
			if (installed.length === 1 || isHeadless()) {
				editorCli = installed[0].cli;
			} else {
				const chosen = await promptForEditor(installed);
				if (!chosen) {
					options.stderr("Aborted\n");
					return 1;
				}
				editorCli = chosen;
			}
		}

		// Persist editor choice when requested.
		if (options.save && editorCli !== savedEditor) {
			await updateGlobalConfigKey("editor", editorCli);
			const displayName =
				EDITORS.find((e) => e.cli === editorCli)?.name ?? editorCli;
			options.stdout(`Saved editor "${displayName}" to global config\n`);
		}

		// Build open args.
		const editorDef = EDITORS.find((e) => e.cli === editorCli);
		let openTarget = targetPath;

		if (options.workspace) {
			if (editorDef?.supportsWorkspace) {
				openTarget = await ensureWorkspaceFile(targetPath, repository.repoName);
			} else {
				const displayName = editorDef?.name ?? editorCli;
				options.stderr(
					`gji open: --workspace is not supported for ${displayName}, ignoring\n`,
				);
			}
		}

		const args: string[] = [];
		if (editorDef?.newWindowFlag) {
			args.push(editorDef.newWindowFlag);
		}
		args.push(openTarget);

		try {
			await spawnEditor(editorCli, args);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			options.stderr(`gji open: failed to launch editor: ${message}\n`);
			return 1;
		}

		const displayName = editorDef?.name ?? editorCli;
		await recordWorktreeUsage(targetPath, targetWorktree?.branch ?? null);
		options.stdout(`Opened ${targetPath} in ${displayName}\n`);
		return 0;
	};
}

export const runOpenCommand = createOpenCommand();

async function detectInstalledEditors(): Promise<EditorDefinition[]> {
	const results = await Promise.all(
		EDITORS.map(async (editor) => ({
			editor,
			available: await isCommandAvailable(editor.cli),
		})),
	);
	return results.filter((r) => r.available).map((r) => r.editor);
}

async function isCommandAvailable(command: string): Promise<boolean> {
	try {
		await execFileAsync("which", [command]);
		return true;
	} catch {
		return false;
	}
}

async function defaultPromptForWorktree(
	worktrees: WorktreePromptEntry[],
): Promise<string | null> {
	return promptForSingleWorktree("Choose a worktree to open", worktrees);
}

async function defaultPromptForEditor(
	editors: EditorDefinition[],
): Promise<string | null> {
	const choice = await select<string>({
		message: "Choose an editor",
		options: editors.map((e) => ({ value: e.cli, label: e.name })),
	});

	if (isCancel(choice)) return null;
	return choice;
}

async function ensureWorkspaceFile(
	worktreePath: string,
	repoName: string,
): Promise<string> {
	const workspacePath = join(worktreePath, `${repoName}.code-workspace`);

	try {
		await access(workspacePath);
		return workspacePath;
	} catch {
		// File doesn't exist yet — create it.
	}

	const workspace = { folders: [{ path: "." }], settings: {} };
	await writeFile(
		workspacePath,
		`${JSON.stringify(workspace, null, 2)}\n`,
		"utf8",
	);
	return workspacePath;
}
