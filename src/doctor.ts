import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import { confirm, isCancel } from "@clack/prompts";

import {
	CONFIG_FILE_NAME,
	type GjiConfig,
	GLOBAL_CONFIG_FILE_PATH,
	KNOWN_CONFIG_KEYS,
	KNOWN_GLOBAL_CONFIG_KEYS,
} from "./config.js";
import { EDITORS } from "./editor.js";
import { isHeadless } from "./headless.js";
import { detectRepository, type RepositoryContext } from "./repo.js";
import {
	loadRegistry,
	REGISTRY_FILE_PATH,
	removeMissingRegistryEntries,
} from "./repo-registry.js";
import { resolveSupportedShell, type SupportedShell } from "./shell.js";
import {
	executableExists,
	hasShellIntegration,
	resolveCompletionPath,
	resolveShellConfigPath,
} from "./shell-setup.js";

const execFileAsync = promisify(execFile);
const MINIMUM_GIT_VERSION = { major: 2, minor: 17 };

export type DoctorCheckStatus = "fail" | "ok" | "skip";

export interface DoctorCheck {
	hint?: string;
	id: string;
	message: string;
	status: DoctorCheckStatus;
}

export type DoctorFixStatus =
	| "applied"
	| "declined"
	| "failed"
	| "pending"
	| "skipped";

export interface DoctorFix {
	hint?: string;
	id: string;
	message: string;
	paths?: string[];
	status: DoctorFixStatus;
}

export interface DoctorCommandOptions {
	cwd: string;
	home?: string;
	fix?: boolean;
	json?: boolean;
	interactive?: boolean;
	confirmFixes?: (fixes: DoctorFix[]) => Promise<boolean>;
	shell?: string;
	yes?: boolean;
	stderr?: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

interface ConfigInspection {
	check: DoctorCheck;
	config: GjiConfig;
}

interface DoctorInspection {
	checks: DoctorCheck[];
	missingRegistryPaths: string[];
}

export async function runDoctorCommand(
	options: DoctorCommandOptions,
): Promise<number> {
	if (options.yes && !options.fix) {
		const message = "--yes requires --fix";
		if (options.json) {
			(options.stderr ?? options.stdout)(
				`${JSON.stringify({ error: message })}\n`,
			);
		} else {
			(options.stderr ?? options.stdout)(`gji doctor: ${message}\n`);
		}
		return 1;
	}

	const home = options.home ?? homedir();
	const shell = resolveSupportedShell(
		undefined,
		options.shell ?? process.env.SHELL,
	);
	let inspection = await collectDoctorInspection(options.cwd, home, shell);
	let fixes: DoctorFix[] = [];

	if (options.fix) {
		fixes = buildDoctorFixes(inspection.missingRegistryPaths);
		if (fixes.length > 0) {
			const approval = await requestFixApproval(fixes, options);
			if (approval === "apply") {
				fixes = await applyDoctorFixes(fixes, home);
			} else {
				fixes = fixes.map((fix) => ({
					...fix,
					status: approval,
					hint:
						approval === "pending"
							? "re-run with --yes to apply this fix without a prompt"
							: "run gji doctor --fix again to review this fix",
				}));
			}
		}
		inspection = await collectDoctorInspection(options.cwd, home, shell);
	}

	const problems = inspection.checks.filter(
		(check) => check.status === "fail",
	).length;

	if (options.json) {
		const output = options.fix
			? { checks: inspection.checks, problems, fixes }
			: { checks: inspection.checks, problems };
		options.stdout(`${JSON.stringify(output)}\n`);
	} else {
		options.stdout(renderDoctorChecks(inspection.checks, problems));
		if (options.fix) {
			options.stdout(renderDoctorFixes(fixes));
		}
	}

	return problems > 0 ? 1 : 0;
}

async function collectDoctorInspection(
	cwd: string,
	home: string,
	shell: SupportedShell | null,
): Promise<DoctorInspection> {
	const repository = await detectRepositoryOrSkip(cwd);
	const globalConfig = await inspectConfig(
		GLOBAL_CONFIG_FILE_PATH(home),
		"global",
		KNOWN_GLOBAL_CONFIG_KEYS,
	);
	const localConfig = repository
		? await inspectConfig(
				join(repository.repoRoot, CONFIG_FILE_NAME),
				"local",
				KNOWN_CONFIG_KEYS,
			)
		: null;
	const effectiveConfig = resolveEffectiveConfig(
		globalConfig.config,
		localConfig?.config ?? {},
		repository?.repoRoot,
		home,
	);
	const registry = await inspectRegistry(home);

	return {
		checks: [
			await checkGitVersion(),
			await checkShellIntegration(shell, home),
			await checkCompletion(shell, home),
			globalConfig.check,
			localConfig?.check ??
				skippedCheck(
					"local-config",
					"local config not checked outside a Git repository",
				),
			await checkWorktreeBase(repository, effectiveConfig, home),
			registry.check,
			await checkEditor(effectiveConfig),
		],
		missingRegistryPaths: registry.missingPaths,
	};
}

function buildDoctorFixes(missingRegistryPaths: string[]): DoctorFix[] {
	if (missingRegistryPaths.length === 0) return [];

	const count = missingRegistryPaths.length;
	return [
		{
			id: "repo-registry",
			message: `remove ${count} stale ${count === 1 ? "repository entry" : "repository entries"} from the registry`,
			paths: missingRegistryPaths,
			status: "pending",
		},
	];
}

async function requestFixApproval(
	fixes: DoctorFix[],
	options: DoctorCommandOptions,
): Promise<"apply" | "declined" | "pending"> {
	if (options.yes) return "apply";
	if (!isDoctorInteractive(options)) return "pending";

	const confirmed = options.confirmFixes
		? await options.confirmFixes(fixes)
		: await confirm({
				initialValue: true,
				message: `Apply ${fixes.length} automatic ${fixes.length === 1 ? "fix" : "fixes"} (${fixes.flatMap((fix) => fix.paths ?? []).join(", ")})?`,
			});
	if (isCancel(confirmed) || !confirmed) return "declined";
	return "apply";
}

function isDoctorInteractive(options: DoctorCommandOptions): boolean {
	if (options.json || isHeadless()) return false;
	if (options.interactive !== undefined) return options.interactive;
	return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

async function applyDoctorFixes(
	fixes: DoctorFix[],
	home: string,
): Promise<DoctorFix[]> {
	return Promise.all(
		fixes.map(async (fix) => {
			try {
				const result = await removeMissingRegistryEntries(
					new Set(fix.paths ?? []),
					home,
				);
				const removedCount = result.removedPaths.length;
				const skippedCount = result.skippedPaths.length;
				return {
					...fix,
					message:
						removedCount === 0
							? "no stale repository entries were removed"
							: `removed ${removedCount} stale ${removedCount === 1 ? "repository entry" : "repository entries"} from the registry`,
					status:
						removedCount === 0 ? ("skipped" as const) : ("applied" as const),
					hint:
						skippedCount > 0
							? `${skippedCount} path(s) were no longer confirmed missing`
							: undefined,
				};
			} catch (error) {
				return {
					...fix,
					status: "failed" as const,
					hint: error instanceof Error ? error.message : String(error),
				};
			}
		}),
	);
}

async function detectRepositoryOrSkip(
	cwd: string,
): Promise<RepositoryContext | null> {
	try {
		return await detectRepository(cwd);
	} catch {
		return null;
	}
}

async function inspectConfig(
	path: string,
	label: "global" | "local",
	knownKeys: ReadonlySet<string>,
): Promise<ConfigInspection> {
	try {
		const contents = await readFile(path, "utf8");
		const value = JSON.parse(contents) as unknown;

		if (!isConfigObject(value)) {
			return {
				check: failedCheck(
					`${label}-config`,
					`${label} config must contain a JSON object (${path})`,
					"replace the file contents with a JSON object",
				),
				config: {},
			};
		}

		const unknownKeys = Object.keys(value).filter((key) => !knownKeys.has(key));
		const warning =
			unknownKeys.length > 0
				? `; warning: unknown ${unknownKeys.length === 1 ? "key" : "keys"} ${unknownKeys.map((key) => `"${key}"`).join(", ")}`
				: "";

		return {
			check: okCheck(
				`${label}-config`,
				`${label} config valid (${path}${warning})`,
			),
			config: value,
		};
	} catch (error) {
		if (isMissingFileError(error)) {
			return {
				check: okCheck(
					`${label}-config`,
					`${label} config not found (optional)`,
				),
				config: {},
			};
		}

		return {
			check: failedCheck(
				`${label}-config`,
				`${label} config is invalid (${path})`,
				"fix the JSON syntax and run gji doctor again",
			),
			config: {},
		};
	}
}

function isConfigObject(value: unknown): value is GjiConfig {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function resolveEffectiveConfig(
	globalConfig: GjiConfig,
	localConfig: GjiConfig,
	repoRoot: string | undefined,
	home: string,
): GjiConfig {
	const globalBase = { ...globalConfig };
	const repos = globalBase.repos;
	delete globalBase.repos;

	return {
		...globalBase,
		...resolvePerRepoConfig(repos, repoRoot, home),
		...localConfig,
	};
}

function resolvePerRepoConfig(
	repos: unknown,
	repoRoot: string | undefined,
	home: string,
): GjiConfig {
	if (!repoRoot || !isConfigObject(repos)) {
		return {};
	}

	for (const [path, config] of Object.entries(repos)) {
		if (expandTilde(path, home) === repoRoot && isConfigObject(config)) {
			return config;
		}
	}

	return {};
}

function expandTilde(path: string, home: string): string {
	if (path === "~") return home;
	if (path.startsWith("~/")) return join(home, path.slice(2));

	return path;
}

async function checkGitVersion(): Promise<DoctorCheck> {
	try {
		const { stdout } = await execFileAsync("git", ["--version"]);
		const version = parseGitVersion(stdout);

		if (!version) {
			return failedCheck(
				"git-version",
				"could not parse the installed Git version",
				"install Git 2.17 or newer",
			);
		}

		if (isGitVersionSupported(version)) {
			return okCheck("git-version", `git ${version.raw}`);
		}

		return failedCheck(
			"git-version",
			`git ${version.raw} is too old (requires Git 2.17 or newer)`,
			"upgrade Git and run gji doctor again",
		);
	} catch {
		return failedCheck(
			"git-version",
			"git is not available on PATH",
			"install Git 2.17 or newer",
		);
	}
}

function parseGitVersion(output: string): {
	major: number;
	minor: number;
	raw: string;
} | null {
	const match = /(?:^|\s)(\d+)\.(\d+)(?:\.(\d+))?/.exec(output);

	if (!match) return null;

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		raw: match.slice(1).filter(Boolean).join("."),
	};
}

function isGitVersionSupported(version: {
	major: number;
	minor: number;
}): boolean {
	return (
		version.major > MINIMUM_GIT_VERSION.major ||
		(version.major === MINIMUM_GIT_VERSION.major &&
			version.minor >= MINIMUM_GIT_VERSION.minor)
	);
}

async function checkShellIntegration(
	shell: SupportedShell | null,
	home: string,
): Promise<DoctorCheck> {
	if (!shell) {
		return skippedCheck(
			"shell-integration",
			"shell integration not checked (unable to detect a supported shell)",
		);
	}

	const rcPath = resolveShellConfigPath(shell, home);
	try {
		const contents = await readFile(rcPath, "utf8");
		if (hasShellIntegration(contents, shell)) {
			return okCheck(
				"shell-integration",
				`${shell} integration found in ${rcPath}`,
			);
		}
	} catch (error) {
		if (isMissingFileError(error)) {
			return failedCheck(
				"shell-integration",
				`shell integration not found because ${rcPath} does not exist`,
				`create ${rcPath}, then add: eval "$(gji init ${shell})"`,
			);
		}

		return failedCheck(
			"shell-integration",
			`could not read ${rcPath}`,
			`add: eval "$(gji init ${shell})"`,
		);
	}

	return failedCheck(
		"shell-integration",
		`shell integration not found in ${rcPath}`,
		`add: eval "$(gji init ${shell})"`,
	);
}

async function checkCompletion(
	shell: SupportedShell | null,
	home: string,
): Promise<DoctorCheck> {
	if (!shell) {
		return skippedCheck(
			"completion",
			"shell completion not checked (unable to detect a supported shell)",
		);
	}

	const path = resolveCompletionPath(shell, home);
	if (await pathExists(path)) {
		return okCheck("completion", `${shell} completion installed (${path})`);
	}

	return skippedCheck(
		"completion",
		`${shell} completion not installed (optional)`,
		`run: gji completion ${shell} > ${path}`,
	);
}

async function checkWorktreeBase(
	repository: RepositoryContext | null,
	config: GjiConfig,
	home: string,
): Promise<DoctorCheck> {
	if (!repository) {
		return skippedCheck(
			"worktree-base",
			"worktree base not checked outside a Git repository",
		);
	}

	const basePath = resolveWorktreeBase(repository.repoRoot, config, home);
	const writablePath = await findNearestExistingPath(basePath);
	if (!writablePath) {
		return failedCheck(
			"worktree-base",
			`worktree base cannot be created (${basePath})`,
			"create a writable parent directory or update worktreePath",
		);
	}

	try {
		await access(writablePath, constants.W_OK | constants.X_OK);
		return okCheck("worktree-base", `worktree base writable (${basePath})`);
	} catch {
		return failedCheck(
			"worktree-base",
			`worktree base is not writable (${writablePath})`,
			"update worktreePath to use a writable directory",
		);
	}
}

function resolveWorktreeBase(
	repoRoot: string,
	config: GjiConfig,
	home: string,
): string {
	const configuredPath = config.worktreePath;
	if (
		typeof configuredPath === "string" &&
		(configuredPath.startsWith("/") || configuredPath.startsWith("~"))
	) {
		return expandTilde(configuredPath, home);
	}

	return join(dirname(repoRoot), "worktrees", basename(repoRoot));
}

async function findNearestExistingPath(path: string): Promise<string | null> {
	let candidate = path;

	while (true) {
		try {
			await access(candidate, constants.F_OK);
			return candidate;
		} catch {
			const parent = dirname(candidate);
			if (parent === candidate) return null;
			candidate = parent;
		}
	}
}

async function inspectRegistry(home: string): Promise<{
	check: DoctorCheck;
	missingPaths: string[];
}> {
	const entries = await loadRegistry(home);
	const missingEntries = await Promise.all(
		entries.map(async (entry) => ({
			entry,
			status: await inspectRegistryPath(entry.path),
		})),
	);
	const missingCount = missingEntries.filter(
		({ status }) => status === "missing",
	).length;
	const unreadableCount = missingEntries.filter(
		({ status }) => status === "unreadable",
	).length;
	const missingPaths = missingEntries
		.filter(({ status }) => status === "missing")
		.map(({ entry }) => entry.path);

	if (missingCount === 0 && unreadableCount === 0) {
		return {
			check: okCheck(
				"repo-registry",
				`${entries.length} repos registered, all reachable`,
			),
			missingPaths,
		};
	}

	const messageParts: string[] = [];
	if (missingCount > 0) {
		messageParts.push(
			`${missingCount} ${missingCount === 1 ? "path is" : "paths are"} missing`,
		);
	}
	if (unreadableCount > 0) {
		messageParts.push(
			`${unreadableCount} ${unreadableCount === 1 ? "path is" : "paths are"} not accessible`,
		);
	}

	return {
		check: failedCheck(
			"repo-registry",
			`${entries.length} repos registered, ${messageParts.join(", ")}`,
			missingCount > 0
				? `remove confirmed stale entries from ${REGISTRY_FILE_PATH(home)}; check permissions for inaccessible paths`
				: "check permissions for inaccessible paths before removing registry entries",
		),
		missingPaths,
	};
}

async function inspectRegistryPath(
	path: string,
): Promise<"exists" | "missing" | "unreadable"> {
	try {
		await access(path, constants.F_OK);
		return "exists";
	} catch (error) {
		if (isMissingPathError(error)) return "missing";
		return "unreadable";
	}
}

function isMissingPathError(error: unknown): boolean {
	if (!(error instanceof Error) || !("code" in error)) return false;

	const code = (error as NodeJS.ErrnoException).code;
	return code === "ENOENT" || code === "ENOTDIR";
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function checkEditor(config: GjiConfig): Promise<DoctorCheck> {
	const editor = config.editor;
	if (typeof editor !== "string" || editor.length === 0) {
		return skippedCheck("editor", "editor not configured (optional)");
	}

	if (await executableExists(editor)) {
		return okCheck("editor", `editor "${editor}" found on PATH`);
	}

	const knownEditor = EDITORS.some(({ cli }) => cli === editor);
	return failedCheck(
		"editor",
		`editor "${editor}" was not found on PATH`,
		knownEditor
			? `install ${editor} or choose another editor with: gji open --save`
			: "choose another editor with: gji open --save",
	);
}

function okCheck(id: string, message: string): DoctorCheck {
	return { id, message, status: "ok" };
}

function failedCheck(id: string, message: string, hint: string): DoctorCheck {
	return { hint, id, message, status: "fail" };
}

function skippedCheck(id: string, message: string, hint?: string): DoctorCheck {
	return { hint, id, message, status: "skip" };
}

function renderDoctorChecks(checks: DoctorCheck[], problems: number): string {
	const lines = ["gji doctor", ""];

	for (const check of checks) {
		lines.push(` ${statusSymbol(check.status)} ${check.message}`);
		if (check.hint) lines.push(`     ${check.hint}`);
	}

	lines.push(
		"",
		`${problems} ${problems === 1 ? "problem" : "problems"} found.`,
	);

	return `${lines.join("\n")}\n`;
}

function renderDoctorFixes(fixes: DoctorFix[]): string {
	const lines = ["", "Automatic fixes:"];
	if (fixes.length === 0) {
		lines.push(" No automatic fixes available.");
	} else {
		for (const fix of fixes) {
			lines.push(` ${fixStatusSymbol(fix.status)} ${fix.message}`);
			if (fix.paths && fix.paths.length > 0) {
				for (const path of fix.paths) lines.push(`     ${path}`);
			}
			if (fix.hint) lines.push(`     ${fix.hint}`);
		}
	}

	return `${lines.join("\n")}\n`;
}

function fixStatusSymbol(status: DoctorFixStatus): string {
	switch (status) {
		case "applied":
			return "✓";
		case "declined":
			return "-";
		case "failed":
			return "✗";
		case "pending":
			return "!";
		case "skipped":
			return "-";
	}
}

function statusSymbol(status: DoctorCheckStatus): string {
	switch (status) {
		case "fail":
			return "✗";
		case "ok":
			return "✓";
		case "skip":
			return "-";
	}
}
