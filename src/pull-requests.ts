import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PULL_REQUEST_QUERY_TIMEOUT_MS = 2500;

export type PullRequestForge = "bitbucket" | "github" | "gitlab";

export interface PullRequestInfo {
	number: number;
	sourceBranch: string;
	url: string;
}

export interface PullRequestRemote {
	forge: PullRequestForge;
	host: string;
	namespace: string;
	repository: string;
	webBaseUrl: string;
}

export interface PullRequestCommandResult {
	stderr?: string;
	stdout: string;
}

export type PullRequestCommandRunner = (
	command: string,
	args: string[],
	options: {
		cwd: string;
		env: NodeJS.ProcessEnv;
		timeout: number;
	},
) => Promise<PullRequestCommandResult>;

export interface PullRequestQueryDependencies {
	fetch?: typeof fetch;
	runCommand?: PullRequestCommandRunner;
}

export interface PullRequestQuery {
	findOpenPullRequest: (
		repoRoot: string,
		number: number,
	) => Promise<PullRequestInfo | null>;
	listOpenPullRequests: (
		repoRoot: string,
		sourceBranch: string,
	) => Promise<PullRequestInfo[]>;
}

export function parsePullRequestRemote(
	remoteUrl: string,
): PullRequestRemote | null {
	const parsed = parseRemoteUrl(remoteUrl.trim());
	if (parsed === null) return null;

	const forge = detectForge(parsed.host);
	if (forge === null) return null;

	const path = parsed.path
		.replace(/^\/+/, "")
		.replace(/\.git$/, "")
		.split("/")
		.filter(Boolean);
	if (path.length < 2) return null;

	if (forge === "gitlab") {
		const repository = path.at(-1);
		const namespace = path.slice(0, -1).join("/");
		if (repository === undefined || namespace.length === 0) return null;

		return {
			forge,
			host: parsed.host,
			namespace,
			repository,
			webBaseUrl: `https://${parsed.host}`,
		};
	}
	const namespace = path.at(-2);
	const repository = path.at(-1);
	if (namespace === undefined || repository === undefined) return null;

	return {
		forge,
		host: parsed.host,
		namespace,
		repository,
		webBaseUrl: `https://${parsed.host}`,
	};
}

export function createPullRequestQuery(
	dependencies: PullRequestQueryDependencies = {},
): PullRequestQuery {
	const runCommand = dependencies.runCommand ?? defaultRunCommand;
	const fetcher = dependencies.fetch ?? fetch;

	return {
		findOpenPullRequest: (repoRoot, number) =>
			findOpenPullRequest(repoRoot, number, runCommand, fetcher),
		listOpenPullRequests: (repoRoot, sourceBranch) =>
			listOpenPullRequests(repoRoot, sourceBranch, runCommand, fetcher),
	};
}

export const runPullRequestQuery = createPullRequestQuery();

async function listOpenPullRequests(
	repoRoot: string,
	sourceBranch: string,
	runCommand: PullRequestCommandRunner,
	fetcher: typeof fetch,
): Promise<PullRequestInfo[]> {
	const remote = await readPullRequestRemote(repoRoot, runCommand);
	const cliResult = await queryProviderCli(
		remote,
		{ kind: "branch", sourceBranch },
		repoRoot,
		runCommand,
	);
	if (cliResult !== null) return sortPullRequests(cliResult);

	const apiResult = await queryPublicApi(
		remote,
		{ kind: "branch", sourceBranch },
		fetcher,
	);
	return sortPullRequests(apiResult);
}

async function findOpenPullRequest(
	repoRoot: string,
	number: number,
	runCommand: PullRequestCommandRunner,
	fetcher: typeof fetch,
): Promise<PullRequestInfo | null> {
	const remote = await readPullRequestRemote(repoRoot, runCommand);
	const cliResult = await queryProviderCli(
		remote,
		{ kind: "number", number },
		repoRoot,
		runCommand,
	);
	if (cliResult !== null) return cliResult[0] ?? null;

	const apiResult = await queryPublicApi(
		remote,
		{ kind: "number", number },
		fetcher,
	);
	return apiResult[0] ?? null;
}

async function readPullRequestRemote(
	repoRoot: string,
	runCommand: PullRequestCommandRunner,
): Promise<PullRequestRemote> {
	const result = await runCommand(
		"git",
		["remote", "get-url", "origin"],
		commandOptions(repoRoot),
	);
	const remote = parsePullRequestRemote(result.stdout);
	if (remote === null) {
		throw new Error("origin remote is unsupported or missing");
	}

	return remote;
}

async function queryProviderCli(
	remote: PullRequestRemote,
	query: PullRequestQueryInput,
	repoRoot: string,
	runCommand: PullRequestCommandRunner,
): Promise<PullRequestInfo[] | null> {
	const providerCommand = providerCliCommand(remote, query);

	try {
		const result = await runCommand(
			providerCommand.command,
			providerCommand.args,
			commandOptions(repoRoot),
		);
		return parseProviderOutput(remote, result.stdout, query);
	} catch {
		// Missing CLIs, unauthenticated CLIs, and CLI/network failures all use the public API fallback.
		return null;
	}
}

async function queryPublicApi(
	remote: PullRequestRemote,
	query: PullRequestQueryInput,
	fetcher: typeof fetch,
): Promise<PullRequestInfo[]> {
	const url = publicApiUrl(remote, query);
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(),
		PULL_REQUEST_QUERY_TIMEOUT_MS,
	);

	try {
		const response = await fetcher(url, {
			headers: { Accept: "application/json" },
			signal: controller.signal,
		});
		if (response.status === 404 && query.kind === "number") return [];
		if (!response.ok) {
			throw new Error(`public API returned HTTP ${response.status}`);
		}

		const payload: unknown = await response.json();
		return parseApiOutput(remote, payload, query);
	} finally {
		clearTimeout(timer);
	}
}

function parseRemoteUrl(
	remoteUrl: string,
): { host: string; path: string } | null {
	const scpMatch = remoteUrl.match(/^[^@]+@([^:]+):(.+)$/);
	if (scpMatch) {
		return { host: scpMatch[1].toLowerCase(), path: scpMatch[2] };
	}

	try {
		const url = new URL(remoteUrl);
		if (!url.hostname) return null;
		return { host: url.hostname.toLowerCase(), path: url.pathname };
	} catch {
		return null;
	}
}

function detectForge(host: string): PullRequestForge | null {
	if (host === "github.com" || host.includes("github")) return "github";
	if (host === "gitlab.com" || host.includes("gitlab")) return "gitlab";
	if (host === "bitbucket.org" || host.includes("bitbucket")) {
		return "bitbucket";
	}

	return null;
}

interface PullRequestQueryInput {
	kind: "branch" | "number";
	number?: number;
	sourceBranch?: string;
}

interface ProviderCliCommand {
	args: string[];
	command: string;
	cwd?: string;
}

function providerCliCommand(
	remote: PullRequestRemote,
	query: PullRequestQueryInput,
): ProviderCliCommand {
	const coordinate = `${remote.namespace}/${remote.repository}`;
	const sourceBranch = query.sourceBranch ?? "";

	switch (remote.forge) {
		case "github":
			return query.kind === "branch"
				? {
						args: [
							"pr",
							"list",
							"--state",
							"open",
							"--head",
							sourceBranch,
							"--json",
							"number,url,headRefName,state",
							"--limit",
							"100",
							"--repo",
							coordinate,
						],
						command: "gh",
					}
				: {
						args: [
							"pr",
							"view",
							String(query.number),
							"--json",
							"number,url,headRefName,state",
							"--repo",
							coordinate,
						],
						command: "gh",
					};
		case "gitlab":
			return query.kind === "branch"
				? {
						args: [
							"mr",
							"list",
							"--state",
							"opened",
							"--source-branch",
							sourceBranch,
							"--output",
							"json",
							"--per-page",
							"100",
							"--repo",
							coordinate,
						],
						command: "glab",
					}
				: {
						args: [
							"mr",
							"view",
							String(query.number),
							"--output",
							"json",
							"--repo",
							coordinate,
						],
						command: "glab",
					};
		case "bitbucket":
			return query.kind === "branch"
				? {
						args: [
							"pr",
							"list",
							"--state",
							"OPEN",
							"--source",
							sourceBranch,
							"--format",
							"json",
							"--repo",
							coordinate,
						],
						command: "bb",
					}
				: {
						args: [
							"pr",
							"view",
							String(query.number),
							"--format",
							"json",
							"--repo",
							coordinate,
						],
						command: "bb",
					};
	}
}

function parseProviderOutput(
	remote: PullRequestRemote,
	stdout: string,
	query: PullRequestQueryInput,
): PullRequestInfo[] {
	const payload: unknown = JSON.parse(stdout);
	const values =
		remote.forge === "bitbucket" && isRecord(payload)
			? Array.isArray(payload.values)
				? payload.values
				: []
			: Array.isArray(payload)
				? payload
				: [payload];
	return values
		.map((value) => normalizePullRequest(value, query))
		.filter((value): value is PullRequestInfo => value !== null)
		.filter((value) =>
			query.kind === "branch"
				? value.sourceBranch === query.sourceBranch
				: value.number === query.number,
		);
}

function parseApiOutput(
	remote: PullRequestRemote,
	payload: unknown,
	query: PullRequestQueryInput,
): PullRequestInfo[] {
	const values =
		remote.forge === "bitbucket" && isRecord(payload)
			? Array.isArray(payload.values)
				? payload.values
				: []
			: query.kind === "number"
				? [payload]
				: Array.isArray(payload)
					? payload
					: [];

	return values
		.map((value) => normalizePullRequest(value, query))
		.filter((value): value is PullRequestInfo => value !== null)
		.filter((value) =>
			query.kind === "branch"
				? value.sourceBranch === query.sourceBranch
				: value.number === query.number,
		);
}

function normalizePullRequest(
	value: unknown,
	query: PullRequestQueryInput,
): PullRequestInfo | null {
	if (!isRecord(value)) return null;

	const number = numberValue(value.number ?? value.iid ?? value.id);
	const source = isRecord(value.source) ? value.source : null;
	const sourceBranch = stringValue(
		value.headRefName ??
			value.source_branch ??
			(source !== null && isRecord(source.branch)
				? source.branch.name
				: undefined),
	);
	const url = stringValue(
		value.url ??
			value.html_url ??
			value.web_url ??
			(isRecord(value.links) && isRecord(value.links.html)
				? value.links.html.href
				: undefined),
	);
	const state = stringValue(value.state)?.toLowerCase();
	if (number === null || url === null) return null;
	if (query.kind === "number" && number !== query.number) return null;
	if (state !== undefined && !["open", "opened"].includes(state)) return null;

	return {
		number,
		sourceBranch: sourceBranch ?? query.sourceBranch ?? "",
		url,
	};
}

function publicApiUrl(
	remote: PullRequestRemote,
	query: PullRequestQueryInput,
): string {
	const branch = encodeURIComponent(query.sourceBranch ?? "");
	const number = query.number === undefined ? "" : String(query.number);

	switch (remote.forge) {
		case "github": {
			const coordinate = `${encodeURIComponent(remote.namespace)}/${encodeURIComponent(remote.repository)}`;
			return query.kind === "branch"
				? `https://api.github.com/repos/${coordinate}/pulls?state=open&head=${encodeURIComponent(`${remote.namespace}:${query.sourceBranch}`)}&per_page=100`
				: `https://api.github.com/repos/${coordinate}/pulls/${number}`;
		}
		case "gitlab": {
			const project = encodeURIComponent(
				`${remote.namespace}/${remote.repository}`,
			);
			return query.kind === "branch"
				? `${remote.webBaseUrl}/api/v4/projects/${project}/merge_requests?state=opened&source_branch=${branch}&per_page=100`
				: `${remote.webBaseUrl}/api/v4/projects/${project}/merge_requests/${number}`;
		}
		case "bitbucket": {
			const coordinate = `${encodeURIComponent(remote.namespace)}/${encodeURIComponent(remote.repository)}`;
			return query.kind === "branch"
				? `https://api.bitbucket.org/2.0/repositories/${coordinate}/pullrequests?state=OPEN&source.branch.name=${branch}&pagelen=100`
				: `https://api.bitbucket.org/2.0/repositories/${coordinate}/pullrequests/${number}`;
		}
	}
}

function sortPullRequests(pullRequests: PullRequestInfo[]): PullRequestInfo[] {
	return [...pullRequests].sort((a, b) => a.number - b.number);
}

function commandOptions(cwd: string): {
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeout: number;
} {
	return {
		cwd,
		env: {
			...process.env,
			GIT_TERMINAL_PROMPT: "0",
			GH_PROMPT_DISABLED: "1",
			GLAB_NON_INTERACTIVE: "1",
		},
		timeout: PULL_REQUEST_QUERY_TIMEOUT_MS,
	};
}

async function defaultRunCommand(
	command: string,
	args: string[],
	options: {
		cwd: string;
		env: NodeJS.ProcessEnv;
		timeout: number;
	},
): Promise<PullRequestCommandResult> {
	return execFileAsync(command, args, options);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
	if (typeof value === "number" && Number.isInteger(value)) return value;
	if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
	return null;
}
