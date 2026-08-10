import type { RepositoryContext } from "../domain/repository/context.js";
import type { RepoRegistryEntry } from "../domain/repository/registry.js";
import type { WorktreeEntry } from "../domain/worktree/types.js";

export interface RepositoryContextPort {
	detectRepository(cwd: string): Promise<RepositoryContext>;
}

export interface WorktreePort {
	listWorktrees(cwd: string): Promise<WorktreeEntry[]>;
}

export interface RepositoryRefPort {
	getRepositoryRemoteUrl(
		repoRoot: string,
		remote: string,
	): Promise<string | null>;
	hasLocalBranch(repoRoot: string, branch: string): Promise<boolean>;
	hasRemoteBranch(
		repoRoot: string,
		remote: string,
		branch: string,
	): Promise<boolean>;
}

export interface RepositoryRegistryPort {
	loadRegistry(): Promise<RepoRegistryEntry[]>;
}
