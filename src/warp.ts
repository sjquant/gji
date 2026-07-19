import { isHeadless } from "./headless.js";
import { recordWorktreeUsage } from "./history.js";
import {
	createNavigationRepository,
	createNavigationTarget,
	type NavigationRepository,
} from "./navigation-output.js";
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
			`${JSON.stringify(
				createNavigationTarget(target.repository, target.path, target.branch),
				null,
				2,
			)}\n`,
		);
		return 0;
	}

	await recordWorktreeUsage(target.path, target.branch);
	await writeShellOutput(WARP_OUTPUT_FILE_ENV, target.path, options.stdout);
	return 0;
}

export interface WarpTarget {
	branch: string | null;
	path: string;
	repository: NavigationRepository;
}

export async function listRegisteredWorktreeSources(
	cwd: string,
	onSkipped?: (entry: RepoRegistryEntry) => void,
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
	for (const [index, result] of results.entries()) {
		if (result.status === "rejected") {
			onSkipped?.(registry[index]);
			continue;
		}
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

	let skippedRegisteredRepos = 0;
	const allItems = (
		await listRegisteredWorktreeSources(options.cwd, () => {
			skippedRegisteredRepos++;
		})
	).filter((item) => item.repoRoot !== options.excludeRepoRoot);

	if (allItems.length === 0) {
		emitError(
			"no accessible worktrees found in any registered repo.",
			skippedRegisteredRepos > 0
				? "Hint: Run 'gji doctor' to inspect stale repository entries.\n"
				: undefined,
		);
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
			emitError(
				`no worktree found matching: ${options.branch}`,
				skippedRegisteredRepos > 0
					? "Hint: Run 'gji doctor' to inspect stale repository entries.\n"
					: undefined,
			);
			return null;
		}
		return {
			branch: match.worktree.branch,
			path: match.worktree.path,
			repository: createNavigationRepository(
				match.repoName,
				match.repoRoot ??
					(await detectRepository(match.worktree.path)).repoRoot,
			),
		};
	}

	const promptEntries = await buildWorktreePromptEntries(promptSources, {
		includeMetadata: false,
		queryPullRequests: options.queryPullRequests,
	});
	const path = await promptForWarpTarget(promptEntries);
	if (!path) {
		options.stderr("Aborted\n");
		return null;
	}
	const chosenSource = promptSources.find(
		(item) => item.worktree.path === path,
	);
	if (chosenSource === undefined) {
		emitError("selected worktree is no longer registered");
		return null;
	}
	return {
		branch: chosenSource.worktree.branch,
		path,
		repository: createNavigationRepository(
			chosenSource.repoName,
			chosenSource.repoRoot ??
				(await detectRepository(chosenSource.worktree.path)).repoRoot,
		),
	};
}

async function promptForWarpTarget(
	items: WorktreePromptEntry[],
): Promise<string | null> {
	return promptForSingleWorktree("Warp to a worktree", items);
}
