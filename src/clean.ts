import { confirm, isCancel } from "@clack/prompts";

import { loadEffectiveConfig } from "./config.js";
import {
	isBranchMergedInto,
	readWorktreeHealth,
	resolveRemoteDefaultBranch,
	runGit,
} from "./git.js";
import { isHeadless } from "./headless.js";
import type { WorktreeEntry } from "./repo.js";
import {
	formatLastCommit,
	formatUpstreamState,
	readWorktreeInfos,
	serializeWorktreeInfo,
	type WorktreeInfo,
} from "./worktree-info.js";
import {
	deleteBranch,
	forceDeleteBranch,
	forceRemoveWorktree,
	isBranchUnmergedError,
	isWorktreeDeletionError,
	isWorktreeForceRemovalError,
	loadLinkedWorktrees,
	removeWorktree,
} from "./worktree-management.js";
import {
	buildWorktreePromptEntries,
	promptForMultipleWorktrees,
	type WorktreePromptEntry,
} from "./worktree-picker.js";
import {
	defaultConfirmForceDeleteBranch,
	defaultConfirmForceRemoveWorktree,
} from "./worktree-prompts.js";

export interface CleanCommandOptions {
	cwd: string;
	dryRun?: boolean;
	force?: boolean;
	json?: boolean;
	stale?: boolean;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export interface CleanCommandDependencies {
	confirmForceDeleteBranch: (branch: string) => Promise<boolean>;
	confirmForceRemoveWorktree: (worktreePath: string) => Promise<boolean>;
	confirmRemoval: (worktrees: WorktreeEntry[]) => Promise<boolean>;
	promptForWorktrees: (
		worktrees: WorktreePromptEntry[],
	) => Promise<string[] | null>;
}

interface CleanFailure {
	branch: string | null;
	message: string;
	path: string;
}

export function createCleanCommand(
	dependencies: Partial<CleanCommandDependencies> = {},
): (options: CleanCommandOptions) => Promise<number> {
	const promptForWorktrees =
		dependencies.promptForWorktrees ?? defaultPromptForWorktrees;
	const confirmRemoval = dependencies.confirmRemoval ?? defaultConfirmRemoval;
	const confirmForceRemoveWorktree =
		dependencies.confirmForceRemoveWorktree ??
		defaultConfirmForceRemoveWorktree;
	const confirmForceDeleteBranch =
		dependencies.confirmForceDeleteBranch ?? defaultConfirmForceDeleteBranch;

	return async function runCleanCommand(
		options: CleanCommandOptions,
	): Promise<number> {
		const { linkedWorktrees, repository } = await loadLinkedWorktrees(
			options.cwd,
		);
		const linkedCleanupCandidates = linkedWorktrees.filter(
			(worktree) => worktree.path !== repository.currentRoot,
		);
		const staleBaseRef = options.stale
			? await resolveStaleBaseRef(repository.repoRoot, options.stderr)
			: null;
		const cleanupCandidates = options.stale
			? await filterStaleCleanupCandidates(
					repository.repoRoot,
					linkedCleanupCandidates,
					staleBaseRef,
				)
			: linkedCleanupCandidates;

		if (cleanupCandidates.length === 0) {
			if (options.stale) {
				emitNoStaleCandidates(options);
				return 0;
			}

			emitError(options, "No linked worktrees to clean");
			return 1;
		}

		if (!options.dryRun && !options.force && (options.json || isHeadless())) {
			const message = "--force is required";
			if (options.json) {
				emitError(options, message);
			} else {
				options.stderr(
					`gji clean: ${message} in non-interactive mode (GJI_NO_TUI=1)\n`,
				);
			}
			return 1;
		}

		// With --force, or non-interactive dry-runs, skip selection prompt and target all candidates.
		const shouldSelectAll =
			options.force ||
			(options.dryRun && (options.stale || options.json || isHeadless()));
		const selections = shouldSelectAll
			? cleanupCandidates.map((w) => w.path)
			: await promptForWorktrees(
					await buildWorktreePromptEntries(
						cleanupCandidates.map((worktree) => ({
							repoName: repository.repoName,
							worktree,
						})),
					),
				);

		if (!selections || selections.length === 0) {
			options.stderr("Aborted\n");
			return 1;
		}

		const selectedWorktrees = resolveSelectedWorktrees(
			cleanupCandidates,
			selections,
		);

		if (selectedWorktrees.length !== selections.length) {
			options.stderr("Selected worktree no longer exists\n");
			return 1;
		}

		const selectedWorktreeInfos = await readWorktreeInfos(selectedWorktrees);
		const selectedInfoByPath = new Map(
			selectedWorktreeInfos.map((info) => [info.path, info]),
		);

		if (
			!options.dryRun &&
			!options.force &&
			!(await confirmRemoval(selectedWorktrees))
		) {
			options.stderr("Aborted\n");
			return 1;
		}

		if (options.dryRun) {
			if (options.json) {
				const removed = selectedWorktreeInfos.map((info) =>
					serializeWorktreeInfo(info),
				);
				options.stdout(
					`${JSON.stringify({ removed, dryRun: true }, null, 2)}\n`,
				);
			} else {
				for (const info of selectedWorktreeInfos) {
					options.stdout(
						`Would remove worktree at ${info.path} (${formatCleanInfo(info)})\n`,
					);
				}
			}
			return 0;
		}

		const removedWorktrees: WorktreeEntry[] = [];
		const failures: CleanFailure[] = [];

		for (const worktree of selectedWorktrees) {
			if (
				options.stale &&
				!(await isStaleCleanupCandidate(
					repository.repoRoot,
					worktree,
					staleBaseRef,
				))
			) {
				options.stderr(
					`Skipped ${worktree.path}: no longer a safe stale cleanup candidate\n`,
				);
				continue;
			}

			try {
				await removeWorktree(repository.repoRoot, worktree.path);
			} catch (error) {
				if (!isWorktreeForceRemovalError(error)) {
					failures.push({
						branch: worktree.branch,
						message: toMessage(error),
						path: worktree.path,
					});
					continue;
				}

				if (options.stale && !isWorktreeDeletionError(error)) {
					options.stderr(
						`Skipped ${worktree.path}: no longer a safe stale cleanup candidate\n`,
					);
					continue;
				}

				if (
					!options.force &&
					!(await confirmForceRemoveWorktree(worktree.path))
				) {
					failures.push({
						branch: worktree.branch,
						message: "force removal declined",
						path: worktree.path,
					});
					continue;
				}

				try {
					await forceRemoveWorktree(repository.repoRoot, worktree.path);
				} catch (forceError) {
					failures.push({
						branch: worktree.branch,
						message: toMessage(forceError),
						path: worktree.path,
					});
					continue;
				}
			}

			removedWorktrees.push(worktree);

			if (worktree.branch) {
				try {
					await deleteBranch(repository.repoRoot, worktree.branch);
				} catch (error) {
					if (!isBranchUnmergedError(error)) {
						throw error;
					}

					if (
						options.force ||
						(await confirmForceDeleteBranch(worktree.branch))
					) {
						try {
							await forceDeleteBranch(repository.repoRoot, worktree.branch);
						} catch (forceError) {
							options.stderr(
								`Failed to delete branch ${worktree.branch}: ${toMessage(forceError)}\n`,
							);
						}
					} else {
						options.stderr(
							`Branch ${worktree.branch} was not deleted (has unmerged commits)\n`,
						);
					}
				}
			}
		}

		if (options.json) {
			const removed = removedWorktrees.map((worktree) => {
				const info = selectedInfoByPath.get(worktree.path);

				return info === undefined
					? { branch: worktree.branch, path: worktree.path }
					: serializeWorktreeInfo(info);
			});
			const payload =
				failures.length === 0 ? { removed } : { removed, failed: failures };
			options.stdout(`${JSON.stringify(payload, null, 2)}\n`);
		} else if (failures.length > 0) {
			reportCleanFailures(failures, options.stderr);
		} else {
			options.stdout(`${repository.repoRoot}\n`);
		}

		return failures.length === 0 ? 0 : 1;
	};
}

export const runCleanCommand = createCleanCommand();

async function filterStaleCleanupCandidates(
	repoRoot: string,
	worktrees: WorktreeEntry[],
	baseBranch: string | null,
): Promise<WorktreeEntry[]> {
	if (baseBranch === null) {
		return [];
	}

	const results = await Promise.all(
		worktrees.map((worktree) =>
			isStaleCleanupCandidate(repoRoot, worktree, baseBranch),
		),
	);

	return worktrees.filter((_, index) => results[index]);
}

async function resolveStaleBaseRef(
	repoRoot: string,
	stderr: (chunk: string) => void,
): Promise<string | null> {
	const config = await loadEffectiveConfig(repoRoot, undefined, stderr);
	const remote = resolveConfiguredString(config.syncRemote) ?? "origin";

	const configuredDefaultBranch = resolveConfiguredString(
		config.syncDefaultBranch,
	);

	if (configuredDefaultBranch) {
		return await resolveFetchedRemoteRef(
			repoRoot,
			remote,
			configuredDefaultBranch,
		);
	}

	try {
		const remoteDefaultBranch = await resolveRemoteDefaultBranch(
			repoRoot,
			remote,
		);

		return remoteDefaultBranch === null
			? null
			: await resolveFetchedRemoteRef(repoRoot, remote, remoteDefaultBranch);
	} catch {
		return null;
	}
}

async function resolveFetchedRemoteRef(
	repoRoot: string,
	remote: string,
	branch: string,
): Promise<string | null> {
	try {
		await runGit(repoRoot, ["fetch", "--prune", remote]);
		return `${remote}/${branch}`;
	} catch {
		return null;
	}
}

function resolveConfiguredString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

async function isStaleCleanupCandidate(
	repoRoot: string,
	worktree: WorktreeEntry,
	baseBranch: string | null,
): Promise<boolean> {
	if (baseBranch === null) {
		return false;
	}

	if (worktree.branch === null) {
		return false;
	}

	const health = await readWorktreeHealth(worktree.path);

	if (health.status !== "clean" || !health.upstreamGone) {
		return false;
	}

	return isBranchMergedInto(repoRoot, worktree.branch, baseBranch);
}

function resolveSelectedWorktrees(
	worktrees: WorktreeEntry[],
	selections: string[],
): WorktreeEntry[] {
	const selectedWorktrees: WorktreeEntry[] = [];
	const seenPaths = new Set<string>();

	for (const selection of selections) {
		const worktree = worktrees.find(
			(entry) => entry.path === selection || entry.branch === selection,
		);

		if (!worktree || seenPaths.has(worktree.path)) {
			continue;
		}

		selectedWorktrees.push(worktree);
		seenPaths.add(worktree.path);
	}

	return selectedWorktrees;
}

function reportCleanFailures(
	failures: CleanFailure[],
	stderr: (chunk: string) => void,
): void {
	const noun = failures.length === 1 ? "worktree" : "worktrees";

	stderr(`Failed to clean ${failures.length} ${noun}:\n`);
	for (const failure of failures) {
		const branch = failure.branch === null ? "detached" : failure.branch;
		stderr(`- ${failure.path} (${branch}): ${failure.message}\n`);
	}
}

function formatCleanInfo(info: WorktreeInfo): string {
	const branch = info.branch === null ? "detached" : `branch: ${info.branch}`;
	const status = `status: ${info.status}`;
	const upstream = `upstream: ${formatUpstreamState(info.upstream)}`;
	const last = `last: ${formatLastCommit(info.lastCommitTimestamp)}`;

	return [branch, status, upstream, last].join(", ");
}

function emitError(options: CleanCommandOptions, message: string): void {
	if (options.json) {
		options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
	} else {
		options.stderr(`${message}\n`);
	}
}

function emitNoStaleCandidates(options: CleanCommandOptions): void {
	if (options.json) {
		const payload = options.dryRun
			? { removed: [], dryRun: true }
			: { removed: [] };
		options.stdout(`${JSON.stringify(payload, null, 2)}\n`);
		return;
	}

	options.stdout("No stale linked worktrees to clean\n");
}

function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function defaultPromptForWorktrees(
	worktrees: WorktreePromptEntry[],
): Promise<string[] | null> {
	return promptForMultipleWorktrees("Choose worktrees to clean", worktrees);
}

async function defaultConfirmRemoval(
	worktrees: WorktreeEntry[],
): Promise<boolean> {
	const branchCount = worktrees.filter(
		(worktree) => worktree.branch !== null,
	).length;
	const detachedCount = worktrees.length - branchCount;
	const messageParts = [
		`Remove ${worktrees.length} linked worktree${worktrees.length === 1 ? "" : "s"}`,
	];

	if (branchCount > 0) {
		messageParts.push(
			`delete ${branchCount} branch${branchCount === 1 ? "" : "es"}`,
		);
	}

	if (detachedCount > 0) {
		messageParts.push(
			`remove ${detachedCount} detached worktree${detachedCount === 1 ? "" : "s"}`,
		);
	}

	const choice = await confirm({
		active: "Yes",
		inactive: "No",
		initialValue: true,
		message: `${messageParts.join(", ")}?`,
	});

	return !isCancel(choice) && choice;
}
