import type { WorktreeCatalogDependencies } from "../application/worktree/catalog.js";
import type { ContextCardDependencies } from "../application/worktree/context-card.js";
import {
	prepareDependencyBootstrap,
	previewDependencyBootstrap,
	resolveDependencyBootstrapMode,
} from "../infrastructure/bootstrap/dependency-bootstrap.js";
import { validateSyncFilePattern } from "../infrastructure/filesystem/file-sync.js";
import {
	isDirtyWorktree,
	readWorktreeHealth,
} from "../infrastructure/git/health.js";
import {
	isBranchMergedInto,
	readBranchLastCommitTimestamp,
	resolveRemoteBase,
	resolveRemoteDefaultBranch,
} from "../infrastructure/git/refs.js";
import { runGit, runGitRaw } from "../infrastructure/git/runner.js";
import { openBrowser } from "../infrastructure/integrations/browser.js";
import {
	defaultSpawnEditor,
	EDITORS,
} from "../infrastructure/integrations/editor.js";
import {
	createPullRequestQuery,
	type PullRequestQuery,
} from "../infrastructure/integrations/pull-requests.js";
import {
	CONFIG_FILE_NAME,
	GLOBAL_CONFIG_DIRECTORY,
	GLOBAL_CONFIG_FILE_PATH,
	KNOWN_CONFIG_KEYS,
	KNOWN_GLOBAL_CONFIG_KEYS,
	loadConfig,
	loadEffectiveConfig,
	loadGlobalConfig,
	parseConfigValue,
	resolveConfigString,
	saveGlobalConfig,
	saveLocalConfig,
	unsetGlobalConfigKey,
	updateGlobalConfigKey,
} from "../infrastructure/persistence/config.js";
import {
	appendHistory,
	loadHistory,
	recordWorktreeUsage,
} from "../infrastructure/persistence/history.js";
import {
	assignWorktreeSlot,
	getWorktreeSlot,
	loadSlots,
	releaseWorktreeSlot,
} from "../infrastructure/persistence/slots.js";
import {
	clearTask,
	readTask,
	writeTask,
} from "../infrastructure/persistence/task.js";
import { extractHooks, runHook } from "../infrastructure/process/hooks.js";
import {
	configPort,
	repositoryContextPort,
	repositoryRefPort,
	repositoryRegistryPort,
	worktreePort,
} from "../infrastructure/repository/adapters.js";
import {
	loadRegistry,
	REGISTRY_FILE_PATH,
	registerRepo,
	removeMissingRegistryEntries,
} from "../infrastructure/repository/registry.js";
import { bootstrapWorktree } from "../infrastructure/worktree/bootstrap.js";
import {
	readWorktreeInfo,
	readWorktreeInfos,
	serializeWorktreeInfo,
} from "../infrastructure/worktree/info.js";
import {
	deleteBranch,
	forceDeleteBranch,
	forceRemoveWorktree,
	isBranchUnmergedError,
	isSubmoduleWorktreeRemovalError,
	isWorktreeDeletionError,
	isWorktreeForceRemovalError,
	removeWorktree,
} from "../infrastructure/worktree/lifecycle.js";
import type {
	DependencyBootstrapPort,
	WorktreeBootstrapPort,
} from "../ports/bootstrap.js";
import type { ConfigPort } from "../ports/config.js";
import type { GitCommandPort } from "../ports/git.js";
import type {
	RepositoryContextPort,
	RepositoryRefPort,
	RepositoryRegistryPort,
	WorktreePort,
} from "../ports/repository.js";
import {
	formatLastCommit,
	formatRelativeAge,
	formatUpstreamState,
} from "../presentation/worktree/format.js";

export interface CliDependencies {
	config: ConfigPort;
	repositoryContext: RepositoryContextPort;
	repositoryRefs: RepositoryRefPort;
	repositoryRegistry: RepositoryRegistryPort;
	worktrees: WorktreePort;
	worktreeCatalog: WorktreeCatalogDependencies;
	contextCard: ContextCardDependencies;
	pullRequests: PullRequestQuery;
	history: {
		recordWorktreeUsage: typeof recordWorktreeUsage;
	};
	slots: {
		getWorktreeSlot: typeof getWorktreeSlot;
		loadSlots: typeof loadSlots;
		assignWorktreeSlot: typeof assignWorktreeSlot;
		releaseWorktreeSlot: typeof releaseWorktreeSlot;
	};
	hooks: {
		extractHooks: typeof extractHooks;
		runHook: typeof runHook;
	};
	git: GitCommandPort & {
		isDirtyWorktree: typeof isDirtyWorktree;
		readWorktreeHealth: typeof readWorktreeHealth;
		isBranchMergedInto: typeof isBranchMergedInto;
		readBranchLastCommitTimestamp: typeof readBranchLastCommitTimestamp;
		resolveRemoteBase: typeof resolveRemoteBase;
		resolveRemoteDefaultBranch: typeof resolveRemoteDefaultBranch;
	};
	configStore: {
		loadConfig: typeof loadConfig;
		loadGlobalConfig: typeof loadGlobalConfig;
		loadEffectiveConfig: typeof loadEffectiveConfig;
		saveGlobalConfig: typeof saveGlobalConfig;
		saveLocalConfig: typeof saveLocalConfig;
		updateGlobalConfigKey: typeof updateGlobalConfigKey;
		resolveConfigString: typeof resolveConfigString;
		parseConfigValue: typeof parseConfigValue;
		unsetGlobalConfigKey: typeof unsetGlobalConfigKey;
		GLOBAL_CONFIG_FILE_PATH: typeof GLOBAL_CONFIG_FILE_PATH;
		GLOBAL_CONFIG_DIRECTORY: typeof GLOBAL_CONFIG_DIRECTORY;
		CONFIG_FILE_NAME: typeof import("../infrastructure/persistence/config.js").CONFIG_FILE_NAME;
		KNOWN_CONFIG_KEYS: typeof KNOWN_CONFIG_KEYS;
		KNOWN_GLOBAL_CONFIG_KEYS: typeof KNOWN_GLOBAL_CONFIG_KEYS;
	};
	tasks: {
		readTask: typeof readTask;
		writeTask: typeof writeTask;
		clearTask: typeof clearTask;
	};
	historyStore: {
		loadHistory: typeof loadHistory;
		appendHistory: typeof appendHistory;
	};
	registry: {
		loadRegistry: typeof loadRegistry;
		registerRepo: typeof registerRepo;
		REGISTRY_FILE_PATH: typeof REGISTRY_FILE_PATH;
		removeMissingRegistryEntries: typeof removeMissingRegistryEntries;
	};
	worktreeLifecycle: {
		deleteBranch: typeof deleteBranch;
		forceDeleteBranch: typeof forceDeleteBranch;
		forceRemoveWorktree: typeof forceRemoveWorktree;
		removeWorktree: typeof removeWorktree;
		isBranchUnmergedError: typeof isBranchUnmergedError;
		isSubmoduleWorktreeRemovalError: typeof isSubmoduleWorktreeRemovalError;
		isWorktreeDeletionError: typeof isWorktreeDeletionError;
		isWorktreeForceRemovalError: typeof isWorktreeForceRemovalError;
	};
	worktreeInfo: {
		readWorktreeInfo: typeof readWorktreeInfo;
		readWorktreeInfos: typeof readWorktreeInfos;
		serializeWorktreeInfo: typeof serializeWorktreeInfo;
		formatLastCommit: typeof formatLastCommit;
		formatRelativeAge: typeof formatRelativeAge;
		formatUpstreamState: typeof formatUpstreamState;
	};
	bootstrap: {
		bootstrapWorktree: WorktreeBootstrapPort["bootstrapWorktree"];
	} & DependencyBootstrapPort;
	integrations: {
		openBrowser: typeof openBrowser;
		defaultSpawnEditor: typeof defaultSpawnEditor;
		EDITORS: typeof EDITORS;
	};
	filesystem: { validateSyncFilePattern: typeof validateSyncFilePattern };
}

export function createCliDependencies(): CliDependencies {
	const pullRequests = createPullRequestQuery();

	return {
		config: configPort,
		repositoryContext: repositoryContextPort,
		repositoryRefs: repositoryRefPort,
		repositoryRegistry: repositoryRegistryPort,
		worktrees: worktreePort,
		worktreeCatalog: {
			loadHistory: () => loadHistory(),
			readTask,
			readWorktreeInfos,
			queryPullRequests: pullRequests.listOpenPullRequests,
			queryRepositoryPullRequests:
				pullRequests.listOpenPullRequestsForRepository,
		},
		contextCard: {
			listWorktrees: worktreePort.listWorktrees,
			readTask,
			readWorktreeInfo,
		},
		pullRequests,
		history: { recordWorktreeUsage },
		slots: {
			getWorktreeSlot,
			loadSlots,
			assignWorktreeSlot,
			releaseWorktreeSlot,
		},
		hooks: { extractHooks, runHook },
		git: {
			runGit,
			runGitRaw,
			isDirtyWorktree,
			readWorktreeHealth,
			isBranchMergedInto,
			readBranchLastCommitTimestamp,
			resolveRemoteBase,
			resolveRemoteDefaultBranch,
		},
		configStore: {
			loadConfig,
			loadGlobalConfig,
			loadEffectiveConfig,
			saveGlobalConfig,
			saveLocalConfig,
			updateGlobalConfigKey,
			resolveConfigString,
			parseConfigValue,
			unsetGlobalConfigKey,
			GLOBAL_CONFIG_FILE_PATH,
			GLOBAL_CONFIG_DIRECTORY,
			CONFIG_FILE_NAME,
			KNOWN_CONFIG_KEYS,
			KNOWN_GLOBAL_CONFIG_KEYS,
		},
		tasks: { readTask, writeTask, clearTask },
		historyStore: { loadHistory, appendHistory },
		registry: {
			loadRegistry,
			registerRepo,
			REGISTRY_FILE_PATH,
			removeMissingRegistryEntries,
		},
		worktreeLifecycle: {
			deleteBranch,
			forceDeleteBranch,
			forceRemoveWorktree,
			removeWorktree,
			isBranchUnmergedError,
			isSubmoduleWorktreeRemovalError,
			isWorktreeDeletionError,
			isWorktreeForceRemovalError,
		},
		worktreeInfo: {
			readWorktreeInfo,
			readWorktreeInfos,
			serializeWorktreeInfo,
			formatLastCommit,
			formatRelativeAge,
			formatUpstreamState,
		},
		bootstrap: {
			bootstrapWorktree,
			resolveMode: resolveDependencyBootstrapMode,
			preview: async (mode, context) =>
				previewDependencyBootstrap(
					await prepareDependencyBootstrap(mode, context),
				),
		},
		integrations: { openBrowser, defaultSpawnEditor, EDITORS },
		filesystem: { validateSyncFilePattern },
	};
}

export const defaultCliDependencies = createCliDependencies();

export function withPullRequestQueries(
	dependencies: CliDependencies,
	queryPullRequests?: WorktreeCatalogDependencies["queryPullRequests"],
	queryRepositoryPullRequests?: WorktreeCatalogDependencies["queryRepositoryPullRequests"],
): WorktreeCatalogDependencies {
	return {
		...dependencies.worktreeCatalog,
		queryPullRequests:
			queryPullRequests ?? dependencies.worktreeCatalog.queryPullRequests,
		queryRepositoryPullRequests:
			queryRepositoryPullRequests ??
			(queryPullRequests === undefined
				? dependencies.worktreeCatalog.queryRepositoryPullRequests
				: undefined),
	};
}
