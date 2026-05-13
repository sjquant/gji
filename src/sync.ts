import { loadEffectiveConfig } from "./config.js";
import { isDirtyWorktree, resolveRemoteDefaultBranch, runGit } from "./git.js";
import { comparePaths } from "./paths.js";
import { detectRepository, listWorktrees, type WorktreeEntry } from "./repo.js";

export interface SyncCommandOptions {
	all?: boolean;
	cwd: string;
	json?: boolean;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export async function runSyncCommand(
	options: SyncCommandOptions,
): Promise<number> {
	const repository = await detectRepository(options.cwd);
	const config = await loadEffectiveConfig(
		repository.repoRoot,
		undefined,
		options.stderr,
	);
	const worktrees = await listWorktrees(options.cwd);
	const remote = resolveConfiguredString(config.syncRemote) ?? "origin";

	let defaultBranch: string | null;
	try {
		defaultBranch =
			resolveConfiguredString(config.syncDefaultBranch) ??
			(await resolveRemoteDefaultBranch(repository.repoRoot, remote));
	} catch {
		emitError(options, `Unable to reach remote '${remote}'`);
		if (!options.json) {
			options.stderr(
				`Hint: Add the remote with: git remote add ${remote} <url>\n`,
			);
		}
		return 1;
	}

	if (!defaultBranch) {
		emitError(options, "Unable to determine the default branch for sync.");
		if (!options.json) {
			options.stderr(
				`Hint: Add the remote with: git remote add ${remote} <url>\n`,
			);
		}
		return 1;
	}

	const targetWorktrees = selectTargetWorktrees(
		worktrees,
		repository.currentRoot,
		options.all,
	);

	if (targetWorktrees === "detached") {
		emitError(
			options,
			`Cannot sync detached worktree: ${repository.currentRoot}`,
		);
		return 1;
	}

	for (const worktree of targetWorktrees) {
		if (await isDirtyWorktree(worktree.path)) {
			emitError(options, `Cannot sync dirty worktree: ${worktree.path}`);
			return 1;
		}
	}

	try {
		await runGit(repository.repoRoot, ["fetch", "--prune", remote]);
	} catch {
		emitError(options, `Failed to fetch from remote '${remote}'`);
		if (!options.json) {
			options.stderr(
				`Hint: Add the remote with: git remote add ${remote} <url>\n`,
			);
		}
		return 1;
	}

	const updatedWorktrees: WorktreeEntry[] = [];

	for (const worktree of targetWorktrees) {
		if (worktree.branch === defaultBranch) {
			await runGit(worktree.path, [
				"merge",
				"--ff-only",
				`${remote}/${defaultBranch}`,
			]);
		} else {
			await runGit(worktree.path, ["rebase", `${remote}/${defaultBranch}`]);
		}

		updatedWorktrees.push(worktree);

		if (!options.json) {
			options.stdout(`${worktree.path}\n`);
		}
	}

	if (options.json) {
		const updated = updatedWorktrees.map((w) => ({
			branch: w.branch as string,
			path: w.path,
		}));
		options.stdout(`${JSON.stringify({ updated }, null, 2)}\n`);
	}

	return 0;
}

function emitError(options: SyncCommandOptions, message: string): void {
	if (options.json) {
		options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
	} else {
		options.stderr(`${message}\n`);
	}
}

function selectTargetWorktrees(
	worktrees: WorktreeEntry[],
	currentRoot: string,
	all: boolean | undefined,
): WorktreeEntry[] | "detached" {
	if (all) {
		return worktrees
			.filter((worktree) => worktree.branch !== null)
			.sort((left, right) => comparePaths(left.path, right.path));
	}

	const currentWorktree = worktrees.find(
		(worktree) => worktree.path === currentRoot,
	);

	if (!currentWorktree) {
		return [];
	}

	if (!currentWorktree.branch) {
		return "detached";
	}

	return [currentWorktree];
}

function resolveConfiguredString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}
