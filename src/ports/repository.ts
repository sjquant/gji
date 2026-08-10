import type { RepositoryContext } from "../domain/repository/context.js";
import type { RepoRegistryEntry } from "../domain/repository/registry.js";
import type { WorktreeEntry } from "../domain/worktree/types.js";

export interface RepositoryPort {
	detectRepository(cwd: string): Promise<RepositoryContext>;
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
	listWorktrees(cwd: string): Promise<WorktreeEntry[]>;
	loadRegistry(): Promise<RepoRegistryEntry[]>;
}
