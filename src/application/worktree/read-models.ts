import type { WorktreeEntry } from "../../domain/worktree/types.js";

export type WorktreeStatus = "clean" | "dirty" | "unknown";

export type UpstreamState =
	| { kind: "detached" }
	| { kind: "no-upstream" }
	| { kind: "stale" }
	| { kind: "tracked"; ahead: number; behind: number }
	| { kind: "unknown" };

export interface WorktreeInfo extends WorktreeEntry {
	lastCommitTimestamp: number | null;
	slot: number | null;
	status: WorktreeStatus;
	task: string | null;
	upstream: UpstreamState;
}

export interface SerializedWorktreeInfo {
	branch: string | null;
	lastCommitTimestamp: number | null;
	path: string;
	slot: number | null;
	status: WorktreeStatus;
	task: string | null;
	upstream: UpstreamState;
}
