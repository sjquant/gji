import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { isCancel, select } from "@clack/prompts";

import { isHeadless } from "./headless.js";
import { recordWorktreeUsage } from "./history.js";
import { runNewCommand } from "./new.js";
import { detectRepository, listWorktrees, type WorktreeEntry } from "./repo.js";
import { loadRegistry, type RepoRegistryEntry } from "./repo-registry.js";
import { writeShellOutput } from "./shell-handoff.js";
import {
	buildWorktreePromptEntries,
	promptForSingleWorktree,
	type QueryWorktreePullRequests,
	resolveWorktreeQuery,
	type WorktreePromptEntry,
} from "./worktree-picker.js";

const WARP_OUTPUT_FILE_ENV = "GJI_WARP_OUTPUT_FILE";

export interface WarpCommandOptions {
	branch?: string;
	cwd: string;
	json?: boolean;
	newWorktree?: boolean;
	queryPullRequests?: QueryWorktreePullRequests;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export interface WarpWorktreeSource {
	repoRoot: string;
	repoName: string;
	worktree: WorktreeEntry;
}

export async function runWarpCommand(
	options: WarpCommandOptions,
): Promise<number> {
	if (options.newWorktree) {
		const registry = await loadRegistry();
		if (registry.length === 0) {
			options.stderr(
				"gji warp: no repos registered yet.\n" +
					"Use any gji command in a repository to register it automatically.\n",
			);
			return 1;
		}
		return runWarpNew(options, registry);
	}

	return runWarpNavigate(options);
}

async function runWarpNavigate(options: WarpCommandOptions): Promise<number> {
	if ((isHeadless() || options.json) && !options.branch) {
		const message = "branch argument is required";
		if (options.json) {
			options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
		} else {
			options.stderr(
				"gji warp: branch argument is required in non-interactive mode (GJI_NO_TUI=1)\n",
			);
		}
		return 1;
	}

	const target = await resolveWarpTarget({
		...options,
		commandName: "gji warp",
		json: options.json,
		queryPullRequests: options.queryPullRequests,
	});
	if (!target) return 1;

	if (options.json) {
		// json callers use the output programmatically; skip history and shell handoff.
		options.stdout(
			`${JSON.stringify({ branch: target.branch, path: target.path }, null, 2)}\n`,
		);
		return 0;
	}

	await recordWorktreeUsage(target.path, target.branch);
	await writeShellOutput(WARP_OUTPUT_FILE_ENV, target.path, options.stdout);
	return 0;
}

async function runWarpNew(
	options: WarpCommandOptions,
	registry: RepoRegistryEntry[],
): Promise<number> {
	const deduplicatedRegistry = await deduplicateRegistryForNew(registry);
	let targetRepoRoot: string;

	if (deduplicatedRegistry.length === 1) {
		targetRepoRoot = deduplicatedRegistry[0].path;
	} else {
		if (isHeadless()) {
			options.stderr(
				"gji warp: repo argument is required in non-interactive mode (GJI_NO_TUI=1)\n",
			);
			return 1;
		}

		const choice = await select<string>({
			message: "Create worktree in which repo?",
			options: deduplicatedRegistry.map((entry) => ({
				value: entry.path,
				label: entry.name,
				hint: entry.path,
			})),
		});

		if (isCancel(choice)) {
			options.stderr("Aborted\n");
			return 1;
		}

		targetRepoRoot = choice;
	}

	if (options.json) {
		return runNewCommand({
			branch: options.branch,
			cwd: targetRepoRoot,
			json: true,
			stderr: options.stderr,
			stdout: options.stdout,
		});
	}

	// runNewCommand writes the created path to options.stdout via writeShellOutput.
	// Since GJI_NEW_OUTPUT_FILE is not set in the warp shell context, it falls
	// through to our captured stdout, giving us the path to hand off.
	let capturedPath = "";
	const captureStdout = (chunk: string) => {
		capturedPath = chunk.trim();
	};

	const exitCode = await runNewCommand({
		branch: options.branch,
		cwd: targetRepoRoot,
		stderr: options.stderr,
		stdout: captureStdout,
	});

	if (exitCode !== 0) {
		return exitCode;
	}

	if (!capturedPath) {
		options.stderr("gji warp: could not determine new worktree path\n");
		return 1;
	}

	await writeShellOutput(WARP_OUTPUT_FILE_ENV, capturedPath, options.stdout);
	return 0;
}

async function deduplicateRegistryForNew(
	registry: RepoRegistryEntry[],
): Promise<RepoRegistryEntry[]> {
	const deduplicated: RepoRegistryEntry[] = [];
	const seenPaths = new Set<string>();

	for (const entry of registry) {
		const canonicalPath = await canonicalizeRepoPath(entry.path);
		if (seenPaths.has(canonicalPath)) {
			continue;
		}

		seenPaths.add(canonicalPath);
		deduplicated.push({
			...entry,
			name: basename(canonicalPath),
			path: canonicalPath,
		});
	}

	return deduplicated;
}

async function canonicalizeRepoPath(repoPath: string): Promise<string> {
	try {
		return await realpath(repoPath);
	} catch {
		return resolve(repoPath);
	}
}

export interface WarpTarget {
	branch: string | null;
	path: string;
}

export async function listRegisteredWorktreeSources(
	cwd: string,
): Promise<WarpWorktreeSource[]> {
	const registry = await loadRegistry();
	const currentRoot = await detectRepository(cwd)
		.then((repository) => repository.currentRoot)
		.catch(() => null);
	const results = await Promise.allSettled(
		registry.map(async (entry) => {
			const worktrees = await listWorktrees(entry.path);
			return { repoName: entry.name, repoRoot: entry.path, worktrees };
		}),
	);

	const allItems: WarpWorktreeSource[] = [];
	for (const result of results) {
		if (result.status === "rejected") continue;
		const { repoName, repoRoot, worktrees } = result.value;
		for (const worktree of worktrees) {
			allItems.push({
				repoRoot,
				repoName,
				worktree: {
					...worktree,
					isCurrent: currentRoot !== null && worktree.path === currentRoot,
				},
			});
		}
	}

	return allItems;
}

export async function resolveWarpTarget(options: {
	branch?: string;
	commandName?: string;
	cwd: string;
	excludeRepoRoot?: string;
	json?: boolean;
	queryPullRequests?: QueryWorktreePullRequests;
	stderr: (chunk: string) => void;
}): Promise<WarpTarget | null> {
	const cmd = options.commandName ?? "gji";

	const emitError = (message: string, hint?: string): void => {
		if (options.json) {
			options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
		} else {
			options.stderr(`${cmd}: ${message}\n`);
			if (hint) options.stderr(hint);
		}
	};

	const registry = await loadRegistry();
	if (registry.length === 0) {
		emitError(
			"not in a git repository and no repos registered yet.",
			"Use any gji command inside a repository to register it.\n",
		);
		return null;
	}

	const allItems = (await listRegisteredWorktreeSources(options.cwd)).filter(
		(item) => item.repoRoot !== options.excludeRepoRoot,
	);

	if (allItems.length === 0) {
		emitError("no accessible worktrees found in any registered repo.");
		return null;
	}

	const promptSources = allItems.map((item) => ({
		repoRoot: item.repoRoot,
		repoName: item.repoName,
		worktree: item.worktree,
	}));

	if (options.branch) {
		const match = resolveWorktreeQuery(promptSources, options.branch);
		if (!match) {
			emitError(`no worktree found matching: ${options.branch}`);
			return null;
		}
		return { branch: match.worktree.branch, path: match.worktree.path };
	}

	const promptEntries = await buildWorktreePromptEntries(promptSources, {
		queryPullRequests: options.queryPullRequests,
	});
	const path = await promptForWarpTarget(promptEntries);
	if (!path) {
		options.stderr("Aborted\n");
		return null;
	}
	const chosen = promptEntries.find((item) => item.path === path);
	return { branch: chosen?.branch ?? null, path };
}

async function promptForWarpTarget(
	items: WorktreePromptEntry[],
): Promise<string | null> {
	return promptForSingleWorktree("Warp to a worktree", items);
}
