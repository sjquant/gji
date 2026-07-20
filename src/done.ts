import { basename } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { loadEffectiveConfig, resolveConfigString } from "./config.js";
import {
	isBranchMergedInto,
	readWorktreeHealth,
	resolveRemoteDefaultBranch,
	runGit,
} from "./git.js";
import { isHeadless } from "./headless.js";
import { loadHistory } from "./history.js";
import { extractHooks, runHook } from "./hooks.js";
import { detectRepository, listWorktrees } from "./repo.js";
import { writeShellOutput } from "./shell-handoff.js";
import { finalizeUndoOperation, recordUndoOperation } from "./undo.js";
import {
	deleteBranch,
	forceDeleteBranch,
	forceRemoveWorktree,
	isBranchUnmergedError,
	isWorktreeForceRemovalError,
	removeWorktree,
} from "./worktree-management.js";

const DONE_OUTPUT_FILE_ENV = "GJI_DONE_OUTPUT_FILE";
export interface DoneCommandOptions {
	branch?: string;
	cwd: string;
	force?: boolean;
	json?: boolean;
	keepBranch?: boolean;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export async function runDoneCommand(
	options: DoneCommandOptions,
): Promise<number> {
	const repository = await detectRepository(options.cwd);
	if (!repository.isWorktree && !options.branch)
		return doneError(options, "gji done: not inside a linked worktree");
	const linked = (await listWorktrees(options.cwd)).filter(
		(entry) => entry.path !== repository.repoRoot,
	);
	const target = options.branch
		? linked.find(
				(entry) =>
					entry.branch === options.branch || entry.path === options.branch,
			)
		: linked.find((entry) => entry.path === repository.currentRoot);
	if (!target)
		return doneError(
			options,
			options.branch
				? `gji done: no linked worktree found for ${options.branch}`
				: "gji done: not inside a linked worktree",
		);
	const config = await loadEffectiveConfig(
		repository.repoRoot,
		undefined,
		options.stderr,
	);
	await refreshUpstream(repository.repoRoot, target.path);
	const health = await readWorktreeHealth(target.path);
	if (
		target.branch &&
		!options.force &&
		!options.keepBranch &&
		!(await isSafeToComplete(
			repository.repoRoot,
			target.branch,
			health,
			config,
		))
	) {
		if (options.json || isHeadless())
			return doneError(
				options,
				"branch is not merged and its upstream is not gone; use --force",
			);
		const choice = await confirm({
			message: `branch "${target.branch}" doesn't look merged. Delete anyway?`,
			active: "Yes",
			inactive: "No",
			initialValue: false,
		});
		if (isCancel(choice) || !choice) return doneError(options, "Aborted");
	}
	if (health.status === "dirty" && !options.force) {
		if (options.json || isHeadless())
			return doneError(
				options,
				"worktree has uncommitted changes; use --force",
			);
		const choice = await confirm({
			message: `worktree ${target.path} has uncommitted changes that cannot be undone. Remove anyway?`,
			active: "Yes",
			inactive: "No",
			initialValue: false,
		});
		if (isCancel(choice) || !choice) return doneError(options, "Aborted");
	}
	let journal: Awaited<ReturnType<typeof recordUndoOperation>>;
	try {
		journal = await recordUndoOperation("done", repository.repoRoot, [target]);
	} catch (error) {
		return doneError(
			options,
			`could not write undo journal; no worktree was removed: ${toMessage(error)}`,
		);
	}
	if (!journal)
		return doneError(
			options,
			"could not capture undo state; no worktree was removed",
		);
	await runHook(
		extractHooks(config)["before-remove"],
		target.path,
		{
			branch: target.branch ?? undefined,
			path: target.path,
			repo: basename(repository.repoRoot),
		},
		options.stderr,
	);
	try {
		await removeWorktree(repository.repoRoot, target.path);
	} catch (error) {
		if (!isWorktreeForceRemovalError(error)) {
			await finalizeUndoOperation(journal, []);
			return doneError(
				options,
				`Failed to remove worktree at ${target.path}: ${toMessage(error)}`,
			);
		}
		if (!options.force) {
			if (options.json || isHeadless()) {
				await finalizeUndoOperation(journal, []);
				return doneError(
					options,
					"worktree requires force removal; use --force",
				);
			}
			const choice = await confirm({
				message: `worktree ${target.path} contains uncommitted changes that cannot be undone. Force remove?`,
				active: "Yes",
				inactive: "No",
				initialValue: false,
			});
			if (isCancel(choice) || !choice) {
				await finalizeUndoOperation(journal, []);
				return doneError(options, "Aborted");
			}
		}
		try {
			await forceRemoveWorktree(repository.repoRoot, target.path);
		} catch (forceError) {
			await finalizeUndoOperation(journal, []);
			return doneError(
				options,
				`Failed to remove worktree at ${target.path}: ${toMessage(forceError)}`,
			);
		}
	}
	let branchDeleted = false;
	if (target.branch && !options.keepBranch) {
		try {
			await deleteBranch(repository.repoRoot, target.branch);
			branchDeleted = true;
		} catch (error) {
			if (!isBranchUnmergedError(error))
				return doneError(
					options,
					`Failed to delete branch ${target.branch}: ${toMessage(error)}`,
				);
			if (options.force) {
				try {
					await forceDeleteBranch(repository.repoRoot, target.branch);
					branchDeleted = true;
				} catch (forceError) {
					return doneError(
						options,
						`Failed to delete branch ${target.branch}: ${toMessage(forceError)}`,
					);
				}
			} else if (!options.json) {
				options.stderr(
					`Branch ${target.branch} was not deleted (has unmerged commits)\n`,
				);
			}
		}
	}
	await finalizeUndoOperation(journal, [target]);
	await runGit(repository.repoRoot, ["worktree", "prune"]).catch(
		() => undefined,
	);
	const shouldMove =
		options.branch === undefined || target.path === repository.currentRoot;
	const movedTo = shouldMove
		? await resolveDoneDestination(repository.repoRoot, target.path)
		: null;
	if (!options.json && movedTo)
		await writeShellOutput(DONE_OUTPUT_FILE_ENV, movedTo, options.stdout);
	else if (!options.json && options.branch && process.env[DONE_OUTPUT_FILE_ENV])
		await writeShellOutput(DONE_OUTPUT_FILE_ENV, options.cwd, options.stdout);
	if (options.json)
		options.stdout(
			`${JSON.stringify({ branch: target.branch, path: target.path, deleted: true, branchDeleted, movedTo }, null, 2)}\n`,
		);
	else
		options.stderr(
			`✓ removed ${target.branch ?? "detached worktree"} (worktree${branchDeleted ? " + branch" : ""})${movedTo ? ` → back at ${movedTo}` : ""} · undo: gji undo\n`,
		);
	return 0;
}

async function isSafeToComplete(
	repoRoot: string,
	branch: string,
	health: Awaited<ReturnType<typeof readWorktreeHealth>>,
	config: Record<string, unknown>,
): Promise<boolean> {
	if (health.upstreamGone) return true;
	const remote = resolveConfigString(config, "syncRemote") ?? "origin";
	const configuredDefault = resolveConfigString(config, "syncDefaultBranch");
	const remoteDefault =
		configuredDefault ??
		(await resolveRemoteDefaultBranch(repoRoot, remote).catch(() => null));
	if (remoteDefault) {
		for (const base of [`${remote}/${remoteDefault}`, remoteDefault]) {
			if (await gitRefExists(repoRoot, base))
				return isBranchMergedInto(repoRoot, branch, base).catch(() => false);
		}
		return false;
	}
	const base = await runGit(repoRoot, [
		"symbolic-ref",
		"--short",
		"HEAD",
	]).catch(() => null);
	return base === null
		? false
		: isBranchMergedInto(repoRoot, branch, base).catch(() => false);
}

async function gitRefExists(repoRoot: string, ref: string): Promise<boolean> {
	try {
		await runGit(repoRoot, ["rev-parse", "--verify", ref]);
		return true;
	} catch {
		return false;
	}
}

async function refreshUpstream(
	repoRoot: string,
	worktreePath: string,
): Promise<void> {
	const upstream = await runGit(worktreePath, [
		"rev-parse",
		"--abbrev-ref",
		"--symbolic-full-name",
		"@{u}",
	]).catch(() => null);
	const remote = upstream?.split("/")[0];
	if (!remote) return;
	await runGit(repoRoot, ["fetch", "--prune", "--quiet", remote]).catch(
		() => undefined,
	);
}
async function resolveDoneDestination(
	repoRoot: string,
	removedPath: string,
): Promise<string> {
	const history = await loadHistory();
	for (const entry of history) {
		if (entry.path !== removedPath && entry.path !== repoRoot) {
			try {
				await runGit(entry.path, ["rev-parse", "--show-toplevel"]);
				return entry.path;
			} catch {
				/* stale history */
			}
		}
	}
	return repoRoot;
}
function doneError(options: DoneCommandOptions, message: string): number {
	if (options.json)
		options.stderr(`${JSON.stringify({ error: message }, null, 2)}\n`);
	else options.stderr(`${message}\n`);
	return 1;
}
function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
