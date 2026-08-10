import type { WorktreeEntry } from "./types.js";

export interface WorktreeSource {
	repoRoot?: string;
	repoName: string;
	worktree: WorktreeEntry;
}
