import { execFile } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { isCancel, select } from "@clack/prompts";
import { resolveWorktreeQuery } from "../../domain/worktree/matching.js";
import type { WorktreeEntry } from "../../domain/worktree/types.js";
import type { EditorDefinition } from "../../ports/editor.js";
import {
	buildWorktreePromptEntries,
	promptForSingleWorktree,
	type QueryWorktreePullRequests,
	type WorktreePromptEntry,
} from "../../presentation/worktree/picker.js";
import {
	type CliRuntime,
	defaultCliDependencies,
	withPullRequestQueries,
} from "../dependencies.js";
import { isHeadless } from "../runtime/headless.js";

export type { EditorDefinition };

const execFileAsync = promisify(execFile);

export interface OpenCommandOptions {
	branch?: string;
	cwd: string;
	editor?: string;
	save?: boolean;
	select?: boolean;
	runtime?: CliRuntime<
		| "history"
		| "repositoryContext"
		| "worktrees"
		| "integrations"
		| "configStore"
		| "worktreeCatalog"
	>;
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
	queryPullRequests: QueryWorktreePullRequests;
	spawnEditor: (cli: string, args: string[]) => Promise<void>;
}

export function createOpenCommand(
	dependencies: Partial<OpenCommandDependencies> = {},
): (options: OpenCommandOptions) => Promise<number> {
	const promptForEditor =
		dependencies.promptForEditor ?? defaultPromptForEditor;
	const promptForWorktree =
		dependencies.promptForWorktree ?? defaultPromptForWorktree;

	return async function runOpenCommand(
		options: OpenCommandOptions,
	): Promise<number> {
		const runtime = options.runtime ?? defaultCliDependencies;
		const { recordWorktreeUsage } = runtime.history;
		const { detectRepository } = runtime.repositoryContext;
		const { listWorktrees } = runtime.worktrees;
		const { defaultSpawnEditor, EDITORS } = runtime.integrations;
		const detectEditors =
			dependencies.detectEditors ?? (() => detectInstalledEditors(EDITORS));
		const { loadEffectiveConfig, resolveConfigString, updateGlobalConfigKey } =
			runtime.configStore;
		const spawnEditorWithRuntime =
			dependencies.spawnEditor ?? defaultSpawnEditor;
		if (options.select && options.branch !== undefined) {
			options.stderr("gji open: --select cannot be used with a branch\n");
			return 1;
		}

		if (options.select && isHeadless()) {
			options.stderr(
				"gji open --select: selector is unavailable in non-interactive mode (GJI_NO_TUI=1)\n",
			);
			return 1;
		}

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
		} else if (!options.select) {
			targetWorktree = worktrees.find((w) => w.isCurrent);
			if (!targetWorktree) {
				options.stderr("gji open: unable to identify the current worktree\n");
				return 1;
			}
			targetPath = targetWorktree.path;
		} else {
			const entries = await buildWorktreePromptEntries(
				worktrees.map((worktree) => ({
					repoRoot: repository.repoRoot,
					repoName: repository.repoName,
					worktree,
				})),
				{
					catalog: withPullRequestQueries(
						runtime,
						dependencies.queryPullRequests,
					),
				},
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
			await spawnEditorWithRuntime(editorCli, args);
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

async function detectInstalledEditors(
	editors: readonly EditorDefinition[],
): Promise<EditorDefinition[]> {
	const results = await Promise.all(
		editors.map(async (editor) => ({
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
