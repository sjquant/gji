import { confirm, isCancel } from "@clack/prompts";
import { loadLinkedWorktrees } from "../../application/worktree/catalog.js";
import type { WorktreeInfo } from "../../application/worktree/read-models.js";
import {
	deduplicateWorktreeSources,
	listRegisteredWorktreeSources,
} from "../../application/worktree/sources.js";
import { mapWithConcurrency } from "../../domain/shared/concurrency.js";
import type { WorktreeSource } from "../../domain/worktree/source.js";
import type { WorktreeEntry } from "../../domain/worktree/types.js";
import {
	buildWorktreePromptEntries,
	promptForMultipleWorktrees,
	type WorktreePromptEntry,
	type WorktreePromptScope,
} from "../../presentation/worktree/picker.js";
import {
	defaultConfirmForceDeleteBranch,
	defaultConfirmForceRemoveWorktree,
} from "../../presentation/worktree/prompts.js";
import {
	type CliDependencies,
	type CliRuntime,
	defaultCliDependencies,
} from "../dependencies.js";
import { isHeadless } from "../runtime/headless.js";
import {
	finalizeUndoOperation,
	recordUndoOperation,
	type UndoRecord,
} from "./undo.js";

export interface CleanCommandOptions {
	cwd: string;
	dryRun?: boolean;
	force?: boolean;
	json?: boolean;
	stale?: boolean;
	runtime?: CliRuntime<
		| "git"
		| "config"
		| "configStore"
		| "slots"
		| "repositoryContext"
		| "repositoryRegistry"
		| "worktrees"
		| "worktreeInfo"
		| "worktreeLifecycle"
		| "worktreeCatalog"
	>;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export interface CleanCommandDependencies {
	confirmForceDeleteBranch: (branch: string) => Promise<boolean>;
	confirmForceRemoveWorktree: (worktreePath: string) => Promise<boolean>;
	confirmRemoval: (worktrees: WorktreeEntry[]) => Promise<boolean>;
	promptForWorktrees: (
		worktrees: WorktreePromptEntry[],
		scope?: WorktreePromptScope,
	) => Promise<string[] | null>;
}

interface CleanFailure {
	branch: string | null;
	message: string;
	path: string;
}

interface CleanCandidate {
	repoName: string;
	repoRoot: string;
	staleBaseRef: string | null;
	worktree: WorktreeEntry;
}

const MAX_CLEAN_REPOSITORY_CONCURRENCY = 4;

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
		const runtime = options.runtime ?? defaultCliDependencies;
		const {
			readWorktreeHealth,
			isBranchMergedInto,
			resolveRemoteBase,
			runGit,
		} = runtime.git;
		const { loadEffectiveConfig } = runtime.config;
		const { releaseWorktreeSlot } = runtime.slots;
		const sourceDependencies = {
			...runtime.repositoryContext,
			...runtime.repositoryRegistry,
			...runtime.worktrees,
		};
		const {
			formatLastCommit,
			formatUpstreamState,
			readWorktreeInfos,
			serializeWorktreeInfo,
		} = runtime.worktreeInfo;
		const {
			deleteBranch,
			forceDeleteBranch,
			forceRemoveWorktree,
			isBranchUnmergedError,
			isSubmoduleWorktreeRemovalError,
			isWorktreeDeletionError,
			isWorktreeForceRemovalError,
			removeWorktree,
		} = runtime.worktreeLifecycle;
		const { linkedWorktrees, repository } = await loadLinkedWorktrees(
			options.cwd,
			sourceDependencies,
		);
		const currentSources = linkedWorktrees
			.filter((worktree) => worktree.path !== repository.currentRoot)
			.map((worktree) => ({
				repoName: repository.repoName,
				repoRoot: repository.repoRoot,
				worktree,
			}));
		const currentCandidates = await resolveCleanupCandidates(
			currentSources,
			options.stale,
			options.stderr,
			loadEffectiveConfig,
			resolveRemoteBase,
			runGit,
			readWorktreeHealth,
			isBranchMergedInto,
		);
		let activeCandidates = currentCandidates;
		let allCandidates: CleanCandidate[] | null = null;
		let currentScope = true;
		const interactiveSelection =
			!options.force && !options.json && !isHeadless();
		const skippedRepositories: Array<{ name: string; path: string }> = [];
		const loadAllCandidates = async (
			signal?: AbortSignal,
		): Promise<CleanCandidate[]> => {
			throwIfAborted(signal);
			if (allCandidates !== null) return allCandidates;

			const registeredSources = await listRegisteredWorktreeSources(
				options.cwd,
				sourceDependencies,
				(entry) => skippedRepositories.push(entry),
				signal,
			);
			if (skippedRepositories.length > 0) {
				reportSkippedRepositories(skippedRepositories, options.stderr);
			}
			const sources = deduplicateWorktreeSources([
				...currentSources,
				...registeredSources,
			]).filter(
				(source): source is WorktreeSource & { repoRoot: string } =>
					source.repoRoot !== undefined &&
					source.worktree.path !== source.repoRoot &&
					source.worktree.path !== repository.currentRoot,
			);
			allCandidates = await resolveCleanupCandidates(
				sources,
				options.stale,
				options.stderr,
				loadEffectiveConfig,
				resolveRemoteBase,
				runGit,
				readWorktreeHealth,
				isBranchMergedInto,
				signal,
			);
			throwIfAborted(signal);
			return allCandidates;
		};
		const scope: WorktreePromptScope = {
			label: "current repository",
			toggleLabel: "all repositories",
			toggle: async (signal) => {
				const nextCurrentScope = !currentScope;
				const nextCandidates = nextCurrentScope
					? currentCandidates
					: await loadAllCandidates(signal);
				throwIfAborted(signal);
				currentScope = nextCurrentScope;
				activeCandidates = nextCandidates;
				return {
					entries: await buildWorktreePromptEntries(nextCandidates, {
						metadata: nextCurrentScope ? "full" : "fast",
						catalog: runtime.worktreeCatalog,
					}),
					label: nextCurrentScope ? "current repository" : "all repositories",
					toggleLabel: nextCurrentScope
						? "all repositories"
						: "current repository",
				};
			},
		};

		if (currentCandidates.length === 0 && interactiveSelection) {
			const loadedAllCandidates = await loadAllCandidates();
			if (loadedAllCandidates.length === 0) {
				if (options.stale) {
					emitNoStaleCandidates(options);
					return 0;
				}

				emitError(options, "No linked worktrees to clean");
				return 1;
			}
			currentScope = false;
			activeCandidates = loadedAllCandidates;
			scope.label = "all repositories";
			scope.toggleLabel = "current repository";
		}
		if (currentCandidates.length === 0 && !interactiveSelection) {
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
			? activeCandidates.map(({ worktree }) => worktree.path)
			: await promptForWorktrees(
					await buildWorktreePromptEntries(activeCandidates, {
						metadata: currentScope ? "full" : "fast",
						catalog: runtime.worktreeCatalog,
					}),
					scope,
				);

		if (!selections || selections.length === 0) {
			options.stderr("Aborted\n");
			return 1;
		}

		const selectedCandidates = resolveSelectedCandidates(
			activeCandidates,
			selections,
		);

		if (selectedCandidates.length !== selections.length) {
			options.stderr("Selected worktree no longer exists\n");
			return 1;
		}
		const selectedWorktrees = selectedCandidates.map(
			({ worktree }) => worktree,
		);

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
						`Would remove worktree at ${info.path} (${formatCleanInfo(info, formatLastCommit, formatUpstreamState)})\n`,
					);
				}
			}
			return 0;
		}

		const candidatesByRepository =
			groupCandidatesByRepository(selectedCandidates);
		const journals = new Map<string, UndoRecord>();
		const failures: CleanFailure[] = [];
		try {
			for (const [repoRoot, candidates] of candidatesByRepository) {
				const journal = await recordUndoOperation(
					"clean",
					repoRoot,
					candidates.map(({ worktree }) => worktree),
					undefined,
					runtime,
				);
				if (!journal) {
					await discardUndoRecords(
						journals.values(),
						runtime.configStore.GLOBAL_CONFIG_DIRECTORY,
					);
					emitError(
						options,
						"could not capture undo state; no worktrees were removed",
					);
					return 1;
				}
				journals.set(repoRoot, journal);
			}
		} catch (error) {
			await discardUndoRecords(
				journals.values(),
				runtime.configStore.GLOBAL_CONFIG_DIRECTORY,
			);
			emitError(
				options,
				`could not write undo journal; no worktrees were removed: ${toMessage(error)}`,
			);
			return 1;
		}

		const removedCandidates: CleanCandidate[] = [];
		for (const candidate of selectedCandidates) {
			const { repoRoot, staleBaseRef, worktree } = candidate;
			if (
				options.stale &&
				!(await isStaleCleanupCandidate(
					repoRoot,
					worktree,
					staleBaseRef,
					readWorktreeHealth,
					isBranchMergedInto,
				))
			) {
				options.stderr(
					`Skipped ${worktree.path}: no longer a safe stale cleanup candidate\n`,
				);
				continue;
			}

			try {
				await removeWorktree(repoRoot, worktree.path);
			} catch (error) {
				if (!isWorktreeForceRemovalError(error)) {
					failures.push({
						branch: worktree.branch,
						message: toMessage(error),
						path: worktree.path,
					});
					continue;
				}

				if (
					options.stale &&
					!isWorktreeDeletionError(error) &&
					!isSubmoduleWorktreeRemovalError(error)
				) {
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
					await forceRemoveWorktree(repoRoot, worktree.path);
				} catch (forceError) {
					failures.push({
						branch: worktree.branch,
						message: toMessage(forceError),
						path: worktree.path,
					});
					continue;
				}
			}

			removedCandidates.push(candidate);

			if (worktree.branch) {
				try {
					await deleteBranch(repoRoot, worktree.branch);
				} catch (error) {
					if (!isBranchUnmergedError(error)) {
						failures.push({
							branch: worktree.branch,
							message: toMessage(error),
							path: worktree.path,
						});
						continue;
					}

					if (
						options.force ||
						(await confirmForceDeleteBranch(worktree.branch))
					) {
						try {
							await forceDeleteBranch(repoRoot, worktree.branch);
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
		for (const [repoRoot, journal] of journals) {
			await finalizeUndoOperation(
				journal,
				removedCandidates
					.filter((candidate) => candidate.repoRoot === repoRoot)
					.map(({ worktree }) => worktree),
				undefined,
				runtime.configStore.GLOBAL_CONFIG_DIRECTORY,
			);
		}
		const undoRecords = remainingUndoRecords(
			journals.values(),
			removedCandidates,
		);
		await Promise.all(
			removedCandidates.map(({ worktree }) =>
				releaseWorktreeSlot(worktree.path),
			),
		);

		if (options.json) {
			const removed = removedCandidates.map(({ worktree }) => {
				const info = selectedInfoByPath.get(worktree.path);

				return info === undefined
					? { branch: worktree.branch, path: worktree.path }
					: serializeWorktreeInfo(info);
			});
			const payload = {
				removed,
				...(failures.length === 0 ? {} : { failed: failures }),
				...(needsExplicitUndoIds(undoRecords, repository.repoRoot)
					? {
							undo: undoRecords.map(({ id, repoRoot }) => ({ id, repoRoot })),
						}
					: {}),
			};
			options.stdout(`${JSON.stringify(payload, null, 2)}\n`);
		} else if (failures.length > 0) {
			reportCleanFailures(failures, options.stderr);
			emitUndoHints(undoRecords, repository.repoRoot, options.stderr);
		} else {
			emitUndoHints(undoRecords, repository.repoRoot, options.stderr);
			options.stdout(
				`${[...new Set(selectedCandidates.map(({ repoRoot }) => repoRoot))].join("\n")}\n`,
			);
		}

		return failures.length === 0 ? 0 : 1;
	};
}

export const runCleanCommand = createCleanCommand();

async function resolveCleanupCandidates(
	sources: WorktreeSource[],
	stale: boolean | undefined,
	stderr: (chunk: string) => void,
	loadEffectiveConfig: CliDependencies["config"]["loadEffectiveConfig"],
	resolveRemoteBase: CliDependencies["git"]["resolveRemoteBase"],
	runGit: CliDependencies["git"]["runGit"],
	readWorktreeHealth: CliDependencies["git"]["readWorktreeHealth"],
	isBranchMergedInto: CliDependencies["git"]["isBranchMergedInto"],
	signal?: AbortSignal,
): Promise<CleanCandidate[]> {
	const grouped = new Map<
		string,
		{ repoName: string; worktrees: WorktreeEntry[] }
	>();
	for (const source of sources) {
		if (source.repoRoot === undefined) continue;
		const existing = grouped.get(source.repoRoot);
		if (existing === undefined) {
			grouped.set(source.repoRoot, {
				repoName: source.repoName,
				worktrees: [source.worktree],
			});
		} else {
			existing.worktrees.push(source.worktree);
		}
	}

	const results = await mapWithConcurrency(
		[...grouped.entries()],
		MAX_CLEAN_REPOSITORY_CONCURRENCY,
		async ([repoRoot, group]) => {
			throwIfAborted(signal);
			const staleBaseRef = stale
				? await resolveStaleBaseRef(
						repoRoot,
						stderr,
						loadEffectiveConfig,
						resolveRemoteBase,
						runGit,
					)
				: null;
			const worktrees = stale
				? await filterStaleCleanupCandidates(
						repoRoot,
						group.worktrees,
						staleBaseRef,
						readWorktreeHealth,
						isBranchMergedInto,
						signal,
					)
				: group.worktrees;

			return worktrees.map((worktree) => ({
				repoName: group.repoName,
				repoRoot,
				staleBaseRef,
				worktree,
			}));
		},
		signal,
	);

	return results.flat();
}

function resolveSelectedCandidates(
	candidates: CleanCandidate[],
	selections: string[],
): CleanCandidate[] {
	const selected: CleanCandidate[] = [];
	const seenPaths = new Set<string>();

	for (const selection of selections) {
		const candidate = candidates.find(
			(entry) =>
				entry.worktree.path === selection ||
				entry.worktree.branch === selection,
		);
		if (candidate === undefined || seenPaths.has(candidate.worktree.path)) {
			continue;
		}
		selected.push(candidate);
		seenPaths.add(candidate.worktree.path);
	}

	return selected;
}

function groupCandidatesByRepository(
	candidates: CleanCandidate[],
): Map<string, CleanCandidate[]> {
	const grouped = new Map<string, CleanCandidate[]>();
	for (const candidate of candidates) {
		const existing = grouped.get(candidate.repoRoot);
		if (existing === undefined) grouped.set(candidate.repoRoot, [candidate]);
		else existing.push(candidate);
	}
	return grouped;
}

function remainingUndoRecords(
	records: Iterable<UndoRecord>,
	removedCandidates: CleanCandidate[],
): UndoRecord[] {
	return [...records].filter((record) =>
		removedCandidates.some(
			(candidate) =>
				candidate.repoRoot === record.repoRoot &&
				record.entries.some((entry) => entry.path === candidate.worktree.path),
		),
	);
}

async function discardUndoRecords(
	records: Iterable<UndoRecord>,
	globalConfigDirectory: Parameters<typeof finalizeUndoOperation>[3],
): Promise<void> {
	await Promise.all(
		[...records].map((record) =>
			finalizeUndoOperation(record, [], undefined, globalConfigDirectory),
		),
	);
}

async function filterStaleCleanupCandidates(
	repoRoot: string,
	worktrees: WorktreeEntry[],
	baseBranch: string | null,
	readWorktreeHealth: CliDependencies["git"]["readWorktreeHealth"],
	isBranchMergedInto: CliDependencies["git"]["isBranchMergedInto"],
	signal?: AbortSignal,
): Promise<WorktreeEntry[]> {
	throwIfAborted(signal);
	if (baseBranch === null) {
		return [];
	}

	const results = await Promise.all(
		worktrees.map((worktree) =>
			isStaleCleanupCandidate(
				repoRoot,
				worktree,
				baseBranch,
				readWorktreeHealth,
				isBranchMergedInto,
			),
		),
	);
	throwIfAborted(signal);

	return worktrees.filter((_, index) => results[index]);
}

async function resolveStaleBaseRef(
	repoRoot: string,
	stderr: (chunk: string) => void,
	loadEffectiveConfig: CliDependencies["config"]["loadEffectiveConfig"],
	resolveRemoteBase: CliDependencies["git"]["resolveRemoteBase"],
	runGit: CliDependencies["git"]["runGit"],
): Promise<string | null> {
	const config = await loadEffectiveConfig(repoRoot, undefined, stderr);
	const remote = resolveConfiguredString(config.syncRemote) ?? "origin";

	const configuredDefaultBranch = resolveConfiguredString(
		config.syncDefaultBranch,
	);
	try {
		const remoteBase = await resolveRemoteBase(
			repoRoot,
			remote,
			configuredDefaultBranch ?? undefined,
		);

		return remoteBase === null
			? null
			: resolveFetchedRemoteRef(repoRoot, remote, remoteBase.branch, runGit);
	} catch {
		return null;
	}
}

async function resolveFetchedRemoteRef(
	repoRoot: string,
	remote: string,
	branch: string,
	runGit: CliDependencies["git"]["runGit"],
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
	readWorktreeHealth: CliDependencies["git"]["readWorktreeHealth"],
	isBranchMergedInto: CliDependencies["git"]["isBranchMergedInto"],
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

function emitUndoHints(
	records: UndoRecord[],
	currentRepositoryRoot: string,
	stderr: (chunk: string) => void,
): void {
	if (records.length === 0) return;
	if (!needsExplicitUndoIds(records, currentRepositoryRoot)) {
		stderr("undo: gji undo\n");
		return;
	}

	const message =
		records.length === 1
			? "undo: restore with:"
			: "undo: restore each repository with:";
	stderr(`${message}\n`);
	for (const record of records) {
		stderr(`  gji undo --id ${record.id} (${record.repoRoot})\n`);
	}
}

function needsExplicitUndoIds(
	records: UndoRecord[],
	currentRepositoryRoot: string,
): boolean {
	return (
		records.length > 1 ||
		records.some((record) => record.repoRoot !== currentRepositoryRoot)
	);
}

function reportSkippedRepositories(
	repositories: Array<{ name: string; path: string }>,
	stderr: (chunk: string) => void,
): void {
	const noun = repositories.length === 1 ? "repository" : "repositories";
	stderr(
		`Skipped ${repositories.length} registered ${noun} because worktrees could not be listed:\n`,
	);
	for (const repository of repositories) {
		stderr(`- ${repository.name} (${repository.path})\n`);
	}
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new Error("Operation cancelled");
}

function formatCleanInfo(
	info: WorktreeInfo,
	formatLastCommit: CliDependencies["worktreeInfo"]["formatLastCommit"],
	formatUpstreamState: CliDependencies["worktreeInfo"]["formatUpstreamState"],
): string {
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
	scope?: WorktreePromptScope,
): Promise<string[] | null> {
	return promptForMultipleWorktrees("Choose worktrees to clean", worktrees, {
		scope,
	});
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
