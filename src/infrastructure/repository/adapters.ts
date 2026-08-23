import type { ConfigPort } from "../../ports/config.js";
import type {
	RepositoryContextPort,
	RepositoryRefPort,
	RepositoryRegistryPort,
	WorktreePort,
} from "../../ports/repository.js";
import {
	loadEffectiveConfig,
	resolveConfigString,
} from "../persistence/config.js";
import { detectRepository } from "./context.js";
import {
	getRepositoryRemoteUrl,
	hasLocalBranch,
	hasRemoteBranch,
} from "./refs.js";
import { loadRegistry } from "./registry.js";
import { listWorktrees } from "./worktrees.js";

export const configPort: ConfigPort = {
	loadEffectiveConfig,
	resolveConfigString,
};

export const repositoryContextPort: RepositoryContextPort = {
	detectRepository,
};

export const worktreePort: WorktreePort = {
	listWorktrees,
};

export const repositoryRefPort: RepositoryRefPort = {
	getRepositoryRemoteUrl,
	hasLocalBranch,
	hasRemoteBranch,
};

export const repositoryRegistryPort: RepositoryRegistryPort = {
	loadRegistry,
};
