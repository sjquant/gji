import type {
	SerializedWorktreeInfo,
	UpstreamState,
	WorktreeInfo,
} from "../../application/worktree/read-models.js";
import type { WorktreeEntry } from "../../domain/worktree/types.js";
import { readWorktreeHealth, type WorktreeHealth } from "../git/health.js";
import { readBranchLastCommitTimestamp } from "../git/refs.js";
import { getWorktreeSlot } from "../persistence/slots.js";
import { readTask } from "../persistence/task.js";

const MAX_WORKTREE_INFO_READ_CONCURRENCY = 8;

export type { SerializedWorktreeInfo, UpstreamState, WorktreeInfo };

export async function readWorktreeInfos(
	worktrees: WorktreeEntry[],
): Promise<WorktreeInfo[]> {
	return mapWithConcurrency(
		worktrees,
		MAX_WORKTREE_INFO_READ_CONCURRENCY,
		readWorktreeInfo,
	);
}

async function mapWithConcurrency<Input, Output>(
	items: Input[],
	limit: number,
	mapper: (item: Input) => Promise<Output>,
): Promise<Output[]> {
	const results: Output[] = new Array(items.length);
	let nextIndex = 0;

	async function readNext(): Promise<void> {
		for (;;) {
			const index = nextIndex;
			nextIndex += 1;

			if (index >= items.length) return;

			results[index] = await mapper(items[index]);
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, () => readNext()),
	);

	return results;
}

export async function readWorktreeInfo(
	worktree: WorktreeEntry,
): Promise<WorktreeInfo> {
	const [healthResult, lastCommitResult, slotResult, taskResult] =
		await Promise.allSettled([
			readWorktreeHealth(worktree.path),
			worktree.branch === null
				? null
				: readBranchLastCommitTimestamp(worktree.path, worktree.branch),
			getWorktreeSlot(worktree.path),
			readTask(worktree.path),
		]);
	const health =
		healthResult.status === "fulfilled" ? healthResult.value : null;
	const lastCommitTimestamp =
		lastCommitResult.status === "fulfilled" ? lastCommitResult.value : null;
	const slot = slotResult.status === "fulfilled" ? slotResult.value : null;
	const task =
		taskResult.status === "fulfilled" ? (taskResult.value?.task ?? null) : null;

	return {
		...worktree,
		lastCommitTimestamp,
		slot,
		status: health?.status ?? "unknown",
		task,
		upstream: buildUpstreamState(worktree.branch, health),
	};
}

function buildUpstreamState(
	branch: string | null,
	health: WorktreeHealth | null,
): UpstreamState {
	if (branch === null) {
		return { kind: "detached" };
	}

	if (health === null) {
		return { kind: "unknown" };
	}

	if (!health.hasUpstream) {
		return { kind: "no-upstream" };
	}

	if (health.upstreamGone) {
		return { kind: "stale" };
	}

	return {
		ahead: health.ahead,
		behind: health.behind,
		kind: "tracked",
	};
}

export function serializeWorktreeInfo(
	info: WorktreeInfo,
): SerializedWorktreeInfo {
	return {
		branch: info.branch,
		lastCommitTimestamp: info.lastCommitTimestamp,
		path: info.path,
		slot: info.slot,
		status: info.status,
		task: info.task,
		upstream: info.upstream,
	};
}
