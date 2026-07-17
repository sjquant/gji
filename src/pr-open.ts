import { isCancel, select } from "@clack/prompts";

import { openBrowser } from "./browser.js";
import { isHeadless } from "./headless.js";
import {
	createPullRequestQuery,
	type PullRequestInfo,
} from "./pull-requests.js";
import { detectRepository, listWorktrees, type WorktreeEntry } from "./repo.js";
import {
	buildWorktreePromptEntries,
	promptForSingleWorktree,
	type QueryRepositoryPullRequests,
	type QueryWorktreePullRequests,
	resolveWorktreeQuery,
	type WorktreePromptEntry,
	type WorktreePromptSource,
} from "./worktree-picker.js";

export interface PrOpenCommandOptions {
	cwd: string;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
	select?: boolean;
	target?: string;
}

export interface PrOpenCommandDependencies {
	findOpenPullRequest: (
		repoRoot: string,
		number: number,
	) => Promise<PullRequestInfo | null>;
	openBrowser: (url: string) => Promise<void>;
	promptForPullRequest: (
		pullRequests: PullRequestInfo[],
	) => Promise<PullRequestInfo | null>;
	promptForWorktree: (
		worktrees: WorktreePromptEntry[],
	) => Promise<string | null>;
	queryPullRequests: QueryWorktreePullRequests;
	queryRepositoryPullRequests?: QueryRepositoryPullRequests;
}

export function createPrOpenCommand(
	dependencies: Partial<PrOpenCommandDependencies> = {},
): (options: PrOpenCommandOptions) => Promise<number> {
	const query = createPullRequestQuery();
	const findOpenPullRequest =
		dependencies.findOpenPullRequest ?? query.findOpenPullRequest;
	const openInBrowser = dependencies.openBrowser ?? openBrowser;
	const promptForPullRequest =
		dependencies.promptForPullRequest ?? defaultPromptForPullRequest;
	const promptForWorktree =
		dependencies.promptForWorktree ?? defaultPromptForWorktree;
	const queryPullRequests =
		dependencies.queryPullRequests ?? query.listOpenPullRequests;
	const queryRepositoryPullRequests =
		dependencies.queryRepositoryPullRequests ??
		(dependencies.queryPullRequests === undefined
			? query.listOpenPullRequestsForRepository
			: undefined);

	return async function runPrOpenCommand(
		options: PrOpenCommandOptions,
	): Promise<number> {
		if (options.select && options.target !== undefined) {
			options.stderr("gji pr open: --select cannot be used with a target\n");
			return 1;
		}

		if (options.select && isHeadless()) {
			options.stderr(
				"gji pr open --select: selector is unavailable in non-interactive mode (GJI_NO_TUI=1)\n",
			);
			return 1;
		}

		const repository = await detectRepository(options.cwd).catch((error) => {
			options.stderr(
				`gji pr open: unable to detect the current repository: ${formatError(error)}\n`,
			);
			return null;
		});
		if (repository === null) return 1;

		if (options.target === undefined) {
			if (!options.select) {
				return openCurrentWorktree(
					repository.repoRoot,
					options,
					queryPullRequests,
					promptForPullRequest,
					openInBrowser,
				);
			}

			return openFromWorktreeSelector(
				repository.repoRoot,
				repository.repoName,
				options,
				promptForWorktree,
				promptForPullRequest,
				queryPullRequests,
				queryRepositoryPullRequests,
				openInBrowser,
			);
		}

		const number = parsePrNumberTarget(options.target);
		if (number !== null) {
			return openByNumber(
				repository.repoRoot,
				number,
				options,
				findOpenPullRequest,
				openInBrowser,
			);
		}

		const worktrees = await listWorktrees(options.cwd).catch((error) => {
			options.stderr(
				`gji pr open: unable to list worktrees: ${formatError(error)}\n`,
			);
			return null;
		});
		if (worktrees === null) return 1;

		const match = resolveWorktreeQuery(
			worktrees.map((worktree) => ({
				repoRoot: repository.repoRoot,
				repoName: repository.repoName,
				worktree,
			})),
			options.target,
		);
		if (match === null) {
			options.stderr(
				`gji pr open: no worktree found matching: ${options.target}\n`,
			);
			return 1;
		}

		return openForBranch(
			repository.repoRoot,
			match.worktree.branch,
			options,
			queryPullRequests,
			promptForPullRequest,
			openInBrowser,
		);
	};
}

export const runPrOpenCommand = createPrOpenCommand();

async function openCurrentWorktree(
	repoRoot: string,
	options: PrOpenCommandOptions,
	queryPullRequests: QueryWorktreePullRequests,
	promptForPullRequest: PrOpenCommandDependencies["promptForPullRequest"],
	openInBrowser: (url: string) => Promise<void>,
): Promise<number> {
	const worktrees = await listWorktrees(options.cwd).catch((error) => {
		options.stderr(
			`gji pr open: unable to list worktrees: ${formatError(error)}\n`,
		);
		return null;
	});
	if (worktrees === null) return 1;

	const currentWorktree = worktrees.find((worktree) => worktree.isCurrent);
	if (currentWorktree === undefined) {
		options.stderr("gji pr open: unable to identify the current worktree\n");
		return 1;
	}

	if (currentWorktree.branch === null) {
		options.stderr(
			"gji pr open: current worktree is detached and has no PR branch\n",
		);
		return 1;
	}

	let pullRequests: PullRequestInfo[];
	try {
		pullRequests = await queryPullRequests(repoRoot, currentWorktree.branch);
	} catch (error) {
		options.stderr(
			`gji pr open: failed to look up PRs for current branch ${currentWorktree.branch}: ${formatError(error)}\n`,
		);
		return 1;
	}

	if (pullRequests.length === 0) {
		options.stderr(
			isHeadless()
				? "gji pr open: no open PR found for the current worktree; pass an explicit branch or PR number (for example, gji pr open '#123')\n"
				: "gji pr open: no open PR found for the current worktree; use gji pr open --select to choose another\n",
		);
		return 1;
	}

	return openPullRequests(
		pullRequests,
		options,
		promptForPullRequest,
		openInBrowser,
	);
}

async function openFromWorktreeSelector(
	repoRoot: string,
	repoName: string,
	options: PrOpenCommandOptions,
	promptForWorktree: PrOpenCommandDependencies["promptForWorktree"],
	promptForPullRequest: PrOpenCommandDependencies["promptForPullRequest"],
	queryPullRequests: QueryWorktreePullRequests,
	queryRepositoryPullRequests: QueryRepositoryPullRequests | undefined,
	openInBrowser: (url: string) => Promise<void>,
): Promise<number> {
	const worktrees = await listWorktrees(options.cwd).catch((error) => {
		options.stderr(
			`gji pr open: unable to list worktrees: ${formatError(error)}\n`,
		);
		return null;
	});
	if (worktrees === null) return 1;

	let lookupError: unknown = null;
	const queryForSelector: QueryWorktreePullRequests = async (root, branch) => {
		try {
			return await queryPullRequests(root, branch);
		} catch (error) {
			lookupError ??= error;
			throw error;
		}
	};
	const queryRepositoryForSelector: QueryRepositoryPullRequests | undefined =
		queryRepositoryPullRequests === undefined
			? undefined
			: async (root) => {
					try {
						return await queryRepositoryPullRequests(root);
					} catch (error) {
						lookupError ??= error;
						throw error;
					}
				};
	let connectedWorktrees: Awaited<
		ReturnType<typeof readConnectedWorktreeSources>
	>;
	try {
		connectedWorktrees = await readConnectedWorktreeSources(
			repoRoot,
			repoName,
			worktrees,
			queryForSelector,
			queryRepositoryForSelector,
		);
	} catch {
		connectedWorktrees = { pullRequestsByBranch: new Map(), sources: [] };
	}
	const { pullRequestsByBranch, sources } = connectedWorktrees;
	const entries = await buildWorktreePromptEntries(sources, {
		queryPullRequests: async (_root, branch) =>
			pullRequestsByBranch.get(branch) ?? [],
	});
	const connectedEntries = entries.filter(
		(entry) => (entry.pullRequestNumbers?.length ?? 0) > 0,
	);
	if (connectedEntries.length === 0) {
		if (lookupError !== null) {
			options.stderr(
				`gji pr open: failed to look up open PRs: ${formatError(lookupError)}\n`,
			);
			return 1;
		}
		options.stderr("gji pr open: no open PR worktrees found\n");
		return 1;
	}

	const selectedPath = await promptForWorktree(connectedEntries);
	if (selectedPath === null) {
		options.stderr("Aborted\n");
		return 1;
	}

	const selectedEntry = connectedEntries.find(
		(entry) => entry.path === selectedPath,
	);
	if (selectedEntry === undefined) {
		options.stderr("gji pr open: selected worktree is no longer available\n");
		return 1;
	}

	return openSelectedEntry(
		selectedEntry,
		options,
		promptForPullRequest,
		openInBrowser,
	);
}

async function readConnectedWorktreeSources(
	repoRoot: string,
	repoName: string,
	worktrees: WorktreeEntry[],
	queryPullRequests: QueryWorktreePullRequests,
	queryRepositoryPullRequests: QueryRepositoryPullRequests | undefined,
): Promise<{
	pullRequestsByBranch: Map<string, PullRequestInfo[]>;
	sources: WorktreePromptSource[];
}> {
	const pullRequestsByBranch = new Map<string, PullRequestInfo[]>();

	if (queryRepositoryPullRequests !== undefined) {
		const pullRequests = await queryRepositoryPullRequests(repoRoot);
		for (const worktree of worktrees) {
			if (worktree.branch === null) continue;
			const branchPullRequests = pullRequests.filter(
				(pullRequest) => pullRequest.sourceBranch === worktree.branch,
			);
			if (branchPullRequests.length > 0) {
				pullRequestsByBranch.set(worktree.branch, branchPullRequests);
			}
		}
	} else {
		const branchResults = await Promise.all(
			worktrees.map(async (worktree) => {
				if (worktree.branch === null) {
					return { pullRequests: [], worktree };
				}

				try {
					return {
						pullRequests: await queryPullRequests(repoRoot, worktree.branch),
						worktree,
					};
				} catch {
					return { pullRequests: [], worktree };
				}
			}),
		);

		for (const { pullRequests, worktree } of branchResults) {
			if (worktree.branch !== null && pullRequests.length > 0) {
				pullRequestsByBranch.set(worktree.branch, pullRequests);
			}
		}
	}

	const sources = worktrees.flatMap((worktree) => {
		if (
			worktree.branch === null ||
			!pullRequestsByBranch.has(worktree.branch)
		) {
			return [];
		}

		return [{ repoRoot, repoName, worktree }];
	});

	return { pullRequestsByBranch, sources };
}

async function openByNumber(
	repoRoot: string,
	number: number,
	options: PrOpenCommandOptions,
	findOpenPullRequest: PrOpenCommandDependencies["findOpenPullRequest"],
	openInBrowser: (url: string) => Promise<void>,
): Promise<number> {
	let pullRequest: PullRequestInfo | null;
	try {
		pullRequest = await findOpenPullRequest(repoRoot, number);
	} catch (error) {
		options.stderr(
			`gji pr open: failed to look up PR #${number}: ${formatError(error)}\n`,
		);
		return 1;
	}

	if (pullRequest === null) {
		options.stderr(`gji pr open: no open PR found for #${number}\n`);
		return 1;
	}

	return launchBrowser(pullRequest, options, openInBrowser);
}

async function openForBranch(
	repoRoot: string,
	branch: string | null,
	options: PrOpenCommandOptions,
	queryPullRequests: QueryWorktreePullRequests,
	promptForPullRequest: PrOpenCommandDependencies["promptForPullRequest"],
	openInBrowser: (url: string) => Promise<void>,
): Promise<number> {
	if (branch === null) {
		options.stderr("gji pr open: detached worktrees have no PR branch\n");
		return 1;
	}

	let pullRequests: PullRequestInfo[];
	try {
		pullRequests = await queryPullRequests(repoRoot, branch);
	} catch (error) {
		options.stderr(
			`gji pr open: failed to look up PRs for branch ${branch}: ${formatError(error)}\n`,
		);
		return 1;
	}

	return openPullRequests(
		pullRequests,
		options,
		promptForPullRequest,
		openInBrowser,
	);
}

async function openSelectedEntry(
	entry: WorktreePromptEntry,
	options: PrOpenCommandOptions,
	promptForPullRequest: PrOpenCommandDependencies["promptForPullRequest"],
	openInBrowser: (url: string) => Promise<void>,
): Promise<number> {
	const numbers = entry.pullRequestNumbers ?? [];
	const urls = entry.pullRequestUrls ?? [];
	const pullRequests = numbers
		.map((number, index) => ({
			number,
			sourceBranch: entry.branch ?? "",
			url: urls[index] ?? "",
		}))
		.filter((pullRequest) => pullRequest.url.length > 0);

	return openPullRequests(
		pullRequests,
		options,
		promptForPullRequest,
		openInBrowser,
	);
}

async function openPullRequests(
	pullRequests: PullRequestInfo[],
	options: PrOpenCommandOptions,
	promptForPullRequest: PrOpenCommandDependencies["promptForPullRequest"],
	openInBrowser: (url: string) => Promise<void>,
): Promise<number> {
	if (pullRequests.length === 0) {
		options.stderr("gji pr open: no open PR found for the selected branch\n");
		return 1;
	}
	if (pullRequests.length > 1 && isHeadless()) {
		options.stderr(
			"gji pr open: multiple open PRs found; pass an explicit PR number in non-interactive mode (GJI_NO_TUI=1)\n",
		);
		return 1;
	}

	const selected =
		pullRequests.length === 1
			? pullRequests[0]
			: await promptForPullRequest(pullRequests);
	if (selected === null || selected === undefined) {
		options.stderr("Aborted\n");
		return 1;
	}

	return launchBrowser(selected, options, openInBrowser);
}

async function launchBrowser(
	pullRequest: PullRequestInfo,
	options: PrOpenCommandOptions,
	openInBrowser: (url: string) => Promise<void>,
): Promise<number> {
	try {
		await openInBrowser(pullRequest.url);
	} catch (error) {
		options.stderr(
			`gji pr open: failed to open PR #${pullRequest.number} in the browser: ${formatError(error)}\n`,
		);
		return 1;
	}

	options.stdout(`Opened PR #${pullRequest.number}: ${pullRequest.url}\n`);
	return 0;
}

function parsePrNumberTarget(target: string): number | null {
	const match = target.match(/^#?(\d+)$/);
	return match === null ? null : Number(match[1]);
}

async function defaultPromptForWorktree(
	worktrees: WorktreePromptEntry[],
): Promise<string | null> {
	return promptForSingleWorktree(
		"Choose a worktree with an open PR",
		worktrees,
	);
}

async function defaultPromptForPullRequest(
	pullRequests: PullRequestInfo[],
): Promise<PullRequestInfo | null> {
	const choice = await select<number>({
		message: "Choose a pull request",
		options: pullRequests.map((pullRequest) => ({
			value: pullRequest.number,
			label: `#${pullRequest.number}`,
			hint: pullRequest.url,
		})),
	});

	if (isCancel(choice)) return null;
	return (
		pullRequests.find((pullRequest) => pullRequest.number === choice) ?? null
	);
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
