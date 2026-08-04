import { readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { type CommandRunner, runCommand } from "./command-runner.js";
import { pathExists } from "./fs-utils.js";
import { inspectDestination } from "./safe-destination.js";
import { validateUvRelocation, validateUvStructure } from "./uv-validation.js";

export type BootstrapKind = "dependency" | "build-cache" | "sync-file";
export type BootstrapState = "installed" | "failed";
export type DependencyBootstrapMode = "off" | "install";

export type BootstrapCommandRunner = CommandRunner;

export interface BootstrapPreparationContext {
	detectionRoot?: string;
	sourceRoot: string;
	worktreePath: string;
}

interface BootstrapCommandExecutionContext {
	runCommand: BootstrapCommandRunner;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export interface BootstrapExecutionContext
	extends BootstrapCommandExecutionContext {
	input: BootstrapTargetInput;
}

export interface BootstrapTarget {
	adapter: string;
	kind: BootstrapKind;
	relativePath: string;
	sourceRoot: string;
	detectionRoot?: string;
	worktreePath: string;
	sourcePath?: string;
	targetPath?: string;
	installCommand: string;
	shell: boolean;
}

export type BootstrapTargetInput = "clean" | "preserve";

export interface BootstrapAdapter {
	readonly kind: BootstrapKind;
	readonly name: string;
	readonly relativePath: string;
	detect(context: BootstrapPreparationContext): Promise<BootstrapTarget | null>;
	install(
		target: BootstrapTarget,
		context: BootstrapExecutionContext,
	): Promise<void>;
}

export interface DependencyBootstrapPlan {
	mode: DependencyBootstrapMode;
	targets: readonly BootstrapTarget[];
}

export interface BootstrapEvent {
	adapter: string;
	kind: BootstrapKind;
	reason?: string;
	state: BootstrapState;
	target: string;
	message: string;
}

export interface DependencyBootstrapReporter {
	dependency(event: BootstrapEvent): void;
}

export interface DependencyBootstrapReport {
	mode: DependencyBootstrapMode;
	ready: boolean;
	events: readonly BootstrapEvent[];
}

export interface DependencyBootstrapDependencies {
	runCommand?: BootstrapCommandRunner;
	stderr?: (chunk: string) => void;
	stdout?: (chunk: string) => void;
}

export interface DependencyBootstrapPreview {
	mode: DependencyBootstrapMode;
	targets: readonly {
		adapter: string;
		kind: BootstrapKind;
		target: string;
		command: string;
	}[];
}

export async function prepareDependencyBootstrap(
	mode: DependencyBootstrapMode,
	context: {
		repoRoot: string;
		currentRoot?: string;
		detectionRoot?: string;
		worktreePath: string;
		cargoBuildCommand?: string;
	},
): Promise<DependencyBootstrapPlan> {
	if (mode === "off") return { mode, targets: [] };

	const adapters = createBootstrapAdapters(context.cargoBuildCommand);
	const sourceRoots: string[] = [];
	for (const sourceRoot of uniquePaths([
		context.repoRoot,
		context.currentRoot,
	])) {
		if (await isAllowedSourceRoot(context.repoRoot, sourceRoot)) {
			sourceRoots.push(sourceRoot);
		}
	}
	const targets: BootstrapTarget[] = [];
	const plannedRelativePaths = new Set<string>();

	for (const adapter of adapters) {
		if (plannedRelativePaths.has(adapter.relativePath)) continue;

		for (const sourceRoot of sourceRoots) {
			const target = await adapter.detect({
				detectionRoot: context.detectionRoot,
				sourceRoot,
				worktreePath: context.worktreePath,
			});
			if (!target) continue;

			targets.push(target);
			plannedRelativePaths.add(adapter.relativePath);
			break;
		}
	}

	return { mode, targets };
}

export function previewDependencyBootstrap(
	plan: DependencyBootstrapPlan,
): DependencyBootstrapPreview {
	return {
		mode: plan.mode,
		targets: plan.targets.map((target) => ({
			adapter: target.adapter,
			kind: target.kind,
			target: target.relativePath,
			command: target.installCommand,
		})),
	};
}

export async function executeDependencyBootstrap(
	plan: DependencyBootstrapPlan,
	options: DependencyBootstrapDependencies & {
		reporter: DependencyBootstrapReporter;
	},
): Promise<DependencyBootstrapReport> {
	if (plan.mode === "off") return { mode: plan.mode, ready: true, events: [] };

	const events: BootstrapEvent[] = [];
	const execution: BootstrapCommandExecutionContext = {
		runCommand: options.runCommand ?? runCommand,
		stderr: options.stderr ?? (() => undefined),
		stdout: options.stdout ?? ((chunk) => process.stdout.write(chunk)),
	};

	if (plan.targets.length === 0) {
		return { mode: plan.mode, ready: true, events };
	}

	for (const target of plan.targets) {
		await installTarget(
			adapterForTarget(target),
			target,
			execution,
			events,
			options.reporter,
		);
	}

	return {
		mode: plan.mode,
		ready: !events.some(({ state }) => state === "failed"),
		events,
	};
}

async function installTarget(
	adapter: BootstrapAdapter,
	target: BootstrapTarget,
	execution: BootstrapCommandExecutionContext,
	events: BootstrapEvent[],
	reporter: DependencyBootstrapReporter,
): Promise<void> {
	const beforeInstallInspection = target.targetPath
		? await inspectDestination(target.worktreePath, target.targetPath)
		: undefined;
	if (beforeInstallInspection?.kind === "unsafe") {
		recordBootstrapFailure(
			events,
			reporter,
			adapter,
			target,
			beforeInstallInspection.reason,
			"destination-unsafe",
		);
		return;
	}
	const effectiveInput: BootstrapTargetInput =
		beforeInstallInspection?.kind === "exists" ? "preserve" : "clean";
	try {
		await adapter.install(target, { ...execution, input: effectiveInput });
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			state: "installed",
			target: target.relativePath,
			message: installSuccessMessage(target, effectiveInput),
		});
	} catch (error) {
		recordBootstrapFailure(
			events,
			reporter,
			adapter,
			target,
			formatInstallFailure(error),
			"install-failed",
		);
	}
}

function installSuccessMessage(
	_target: BootstrapTarget,
	input: BootstrapTargetInput,
): string {
	if (input === "preserve") return "installed into the existing target";
	return "installed into a clean target";
}

function recordBootstrapFailure(
	events: BootstrapEvent[],
	reporter: DependencyBootstrapReporter,
	adapter: BootstrapAdapter,
	target: BootstrapTarget,
	message: string,
	reason?: string,
): void {
	recordBootstrapEvent(events, reporter, {
		adapter: adapter.name,
		kind: adapter.kind,
		reason,
		state: "failed",
		target: target.relativePath,
		message,
	});
}

function recordBootstrapEvent(
	events: BootstrapEvent[],
	reporter: DependencyBootstrapReporter,
	event: BootstrapEvent,
): void {
	events.push(event);
	reporter.dependency(event);
}

function formatInstallFailure(error: unknown): string {
	return `install failed: ${toErrorMessage(error)}`;
}

function adapterForTarget(target: BootstrapTarget): BootstrapAdapter {
	const adapter = createBootstrapAdapters().find(
		(candidate) => candidate.name === target.adapter,
	);
	if (!adapter)
		throw new Error(`unsupported bootstrap adapter: ${target.adapter}`);
	return adapter;
}

function createBootstrapAdapters(
	cargoBuildCommand?: string,
): readonly BootstrapAdapter[] {
	return [
		new LockfileBootstrapAdapter({
			name: "pnpm",
			kind: "dependency",
			lockfiles: ["pnpm-lock.yaml"],
			relativePath: "node_modules",
			installCommand: "pnpm install --frozen-lockfile",
		}),
		new LockfileBootstrapAdapter({
			name: "yarn",
			kind: "dependency",
			lockfiles: ["yarn.lock"],
			relativePath: "node_modules",
			installCommand: "yarn install --frozen-lockfile",
			selectInstallCommand: async (_target, _input) =>
				(await isYarnBerry(_target.detectionRoot ?? _target.sourceRoot))
					? "yarn install --immutable"
					: "yarn install --frozen-lockfile",
		}),
		new LockfileBootstrapAdapter({
			name: "bun",
			kind: "dependency",
			lockfiles: ["bun.lock", "bun.lockb"],
			relativePath: "node_modules",
			installCommand: "bun install --frozen-lockfile",
		}),
		new LockfileBootstrapAdapter({
			name: "npm",
			kind: "dependency",
			lockfiles: ["package-lock.json"],
			relativePath: "node_modules",
			installCommand: "npm ci",
			selectInstallCommand: (_target, input) =>
				input === "preserve" ? "npm install" : "npm ci",
		}),
		new LockfileBootstrapAdapter({
			name: "bundler",
			kind: "dependency",
			lockfiles: ["Gemfile.lock"],
			relativePath: "vendor/bundle",
			installCommand: "bundle install",
			commandOptions: () => ({
				env: { BUNDLE_PATH: "vendor/bundle" },
			}),
		}),
		new LockfileBootstrapAdapter({
			name: "poetry",
			kind: "dependency",
			lockfiles: ["poetry.lock"],
			relativePath: ".venv",
			installCommand: "poetry install --no-interaction",
			commandOptions: () => ({
				env: { POETRY_VIRTUALENVS_IN_PROJECT: "true" },
			}),
		}),
		new LockfileBootstrapAdapter({
			name: "uv",
			kind: "dependency",
			lockfiles: ["uv.lock"],
			relativePath: ".venv",
			installCommand: "uv sync --locked",
			beforeInstall: validateUvStructure,
			afterInstall: validateUvRelocation,
		}),
		new LockfileBootstrapAdapter({
			name: "pipenv",
			kind: "dependency",
			lockfiles: ["Pipfile.lock"],
			relativePath: ".venv",
			installCommand: "pipenv sync",
			commandOptions: () => ({
				env: { PIPENV_VENV_IN_PROJECT: "1" },
			}),
		}),
		new LockfileBootstrapAdapter({
			name: "go",
			kind: "dependency",
			lockfiles: ["go.mod"],
			relativePath: "",
			installCommand: "go mod download",
		}),
		new LockfileBootstrapAdapter({
			name: "composer",
			kind: "dependency",
			lockfiles: ["composer.lock"],
			relativePath: "vendor",
			installCommand: "composer install --no-interaction --prefer-dist",
		}),
		new LockfileBootstrapAdapter({
			name: "cargo",
			kind: "build-cache",
			lockfiles: ["Cargo.lock"],
			relativePath: "target",
			installCommand: cargoBuildCommand?.trim() || "cargo check",
			shell: Boolean(cargoBuildCommand),
		}),
	];
}

interface LockfileBootstrapAdapterSpec {
	name: string;
	kind: BootstrapKind;
	lockfiles: readonly string[];
	relativePath: string;
	installCommand: string;
	shell?: boolean;
	beforeInstall?: (
		target: BootstrapTarget,
		context: BootstrapExecutionContext,
	) => Promise<void>;
	afterInstall?: (
		target: BootstrapTarget,
		context: BootstrapExecutionContext,
	) => Promise<void>;
	commandOptions?: (
		target: BootstrapTarget,
	) => Parameters<BootstrapCommandRunner>[4];
	selectInstallCommand?: (
		target: BootstrapTarget,
		input: BootstrapTargetInput,
	) => string | Promise<string>;
}

class LockfileBootstrapAdapter implements BootstrapAdapter {
	readonly kind: BootstrapKind;
	readonly name: string;
	readonly relativePath: string;
	private readonly defaultInstallCommand: string;
	private readonly lockfiles: readonly string[];
	private readonly shell: boolean;
	private readonly beforeInstall?: (
		target: BootstrapTarget,
		context: BootstrapExecutionContext,
	) => Promise<void>;
	private readonly afterInstall?: (
		target: BootstrapTarget,
		context: BootstrapExecutionContext,
	) => Promise<void>;
	private readonly commandOptions?: (
		target: BootstrapTarget,
	) => Parameters<BootstrapCommandRunner>[4];
	private readonly selectInstallCommand?: (
		target: BootstrapTarget,
		input: BootstrapTargetInput,
	) => string | Promise<string>;

	constructor(spec: LockfileBootstrapAdapterSpec) {
		this.name = spec.name;
		this.kind = spec.kind;
		this.lockfiles = spec.lockfiles;
		this.relativePath = spec.relativePath;
		this.defaultInstallCommand = spec.installCommand;
		this.shell = spec.shell ?? false;
		this.beforeInstall = spec.beforeInstall;
		this.afterInstall = spec.afterInstall;
		this.commandOptions = spec.commandOptions;
		this.selectInstallCommand = spec.selectInstallCommand;
	}

	async detect(
		context: BootstrapPreparationContext,
	): Promise<BootstrapTarget | null> {
		const detectionRoot = context.detectionRoot ?? context.sourceRoot;
		const hasLockfile = await hasExistingPath(detectionRoot, this.lockfiles);
		if (!hasLockfile) return null;

		const sourcePath = this.relativePath
			? join(context.sourceRoot, this.relativePath)
			: undefined;
		const targetPath = this.relativePath
			? join(context.worktreePath, this.relativePath)
			: undefined;
		const destinationInspection = targetPath
			? await inspectDestination(context.worktreePath, targetPath)
			: undefined;
		const initialInput =
			destinationInspection?.kind === "exists" ? "preserve" : "clean";
		const target: BootstrapTarget = {
			adapter: this.name,
			kind: this.kind,
			relativePath: this.relativePath,
			sourceRoot: context.sourceRoot,
			detectionRoot,
			worktreePath: context.worktreePath,
			sourcePath,
			targetPath,
			installCommand: this.defaultInstallCommand,
			shell: this.shell,
		};

		return {
			...target,
			installCommand: await this.selectCommand(target, initialInput),
		};
	}

	async install(
		target: BootstrapTarget,
		context: BootstrapExecutionContext,
	): Promise<void> {
		await this.beforeInstall?.(target, context);
		const installCommand = await this.selectCommand(target, context.input);
		await context.runCommand(
			installCommand,
			target.worktreePath,
			context.stderr,
			context.stdout,
			{
				...this.commandOptions?.(target),
				shell: target.shell,
			},
		);
		await this.afterInstall?.(target, context);
	}

	private async selectCommand(
		target: BootstrapTarget,
		input: BootstrapTargetInput,
	): Promise<string> {
		return (
			(await this.selectInstallCommand?.(target, input)) ??
			target.installCommand
		);
	}
}

async function hasExistingPath(
	root: string,
	paths: readonly string[],
): Promise<boolean> {
	for (const path of paths) {
		if (await pathExists(join(root, path))) return true;
	}
	return false;
}

async function isYarnBerry(root: string): Promise<boolean> {
	if (await pathExists(join(root, ".yarnrc.yml"))) return true;

	try {
		const packageJson = JSON.parse(
			await readFile(join(root, "package.json"), "utf8"),
		) as { packageManager?: unknown };
		const packageManager = packageJson.packageManager;
		const match =
			typeof packageManager === "string" &&
			packageManager.match(/^yarn@(\d+)/u);
		return match ? Number(match[1]) >= 2 : false;
	} catch {
		return false;
	}
}

function uniquePaths(paths: readonly (string | undefined)[]): string[] {
	return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}

async function isAllowedSourceRoot(
	repoRoot: string,
	sourceRoot: string,
): Promise<boolean> {
	try {
		const [resolvedRepoRoot, resolvedSourceRoot] = await Promise.all([
			realpath(repoRoot),
			realpath(sourceRoot),
		]);
		if (resolvedRepoRoot === resolvedSourceRoot) return true;

		const gitFile = await readFile(join(resolvedSourceRoot, ".git"), "utf8");
		const gitDirectory = gitFile.match(/^gitdir:\s*(.+)$/mu)?.[1];
		if (!gitDirectory) return false;
		return isWithin(
			join(resolvedRepoRoot, ".git", "worktrees"),
			resolve(resolvedSourceRoot, gitDirectory),
		);
	} catch {
		return false;
	}
}

function isWithin(root: string, candidate: string): boolean {
	const distance = relative(root, candidate);
	return (
		distance === "" || (distance !== ".." && !distance.startsWith(`..${sep}`))
	);
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
