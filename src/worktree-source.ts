import type { WorktreeEntry } from "./repo.js";

export interface WorktreeSource {
	repoRoot?: string;
	repoName: string;
	worktree: WorktreeEntry;
}
