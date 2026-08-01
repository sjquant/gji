import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { lstat, readdir, readFile, realpath, rm } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { promisify } from "node:util";
import { type CommandRunner, runCommand } from "./command-runner.js";
import type { DependencyBootstrapMode } from "./config.js";
import {
	type CloneDirectory,
	cloneDir,
	isCloneDestinationExistsError,
	isCloneInProgressError,
} from "./dir-clone.js";
import { pathExists } from "./fs-utils.js";
import { inspectDestination } from "./safe-destination.js";

const execFileAsync = promisify(execFile);

export type BootstrapKind = "dependency" | "build-cache" | "sync-file";
export type BootstrapState =
	| "seeded"
	| "repaired"
	| "installed"
	| "fallback"
	| "skipped"
	| "failed";
export type BootstrapStrategy =
	| "cow-then-repair"
	| "repair-only"
	| "install-only";

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
	ownership: BootstrapTargetOwnership;
}

export interface BootstrapTarget {
	adapter: string;
	kind: BootstrapKind;
	relativePath: string;
	sourceRoot: string;
	worktreePath: string;
	sourcePath: string;
	targetPath: string;
	repairCommand: string;
	repairState: "repaired" | "installed";
	existingBeforeBootstrap: boolean;
}

export type BootstrapTargetOwnership =
	| "adapter"
	| "syncDirs"
	| "empty"
	| "preserve";

export interface BootstrapRepairFailureContext {
	target: BootstrapTarget;
	ownership: BootstrapTargetOwnership;
	targetExistedBeforeRepair: boolean;
}

export interface BootstrapOutputMetadata {
	adapter: string;
	kind: BootstrapKind;
	target: string;
	repairCommand: string;
}

export interface BootstrapAdapter {
	readonly kind: BootstrapKind;
	readonly lockfile: string;
	readonly name: string;
	readonly relativePath: string;
	detect(context: BootstrapPreparationContext): Promise<BootstrapTarget | null>;
	seedPath(target: BootstrapTarget): string;
	repair(
		target: BootstrapTarget,
		context: BootstrapExecutionContext,
	): Promise<void>;
	canSeed(target: BootstrapTarget): Promise<boolean>;
	output(target: BootstrapTarget): BootstrapOutputMetadata;
	shouldRetryAfterRepairFailure(
		context: BootstrapRepairFailureContext,
	): boolean;
	cleanupAfterRepairFailure(
		context: BootstrapRepairFailureContext,
	): Promise<void>;
}

export interface DependencyBootstrapPlan {
	mode: DependencyBootstrapMode;
	targets: readonly PlannedBootstrapTarget[];
}

export interface PlannedBootstrapTarget {
	adapter: BootstrapAdapter;
	target: BootstrapTarget;
	seedable: boolean;
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
	readonly measureCloneSize: boolean;
	dependency(event: BootstrapEvent): void;
}

export interface DependencyBootstrapReport {
	mode: DependencyBootstrapMode;
	ready: boolean;
	events: readonly BootstrapEvent[];
}

export interface DependencyBootstrapDependencies {
	cloneDirectory?: CloneDirectory;
	runCommand?: BootstrapCommandRunner;
	stderr?: (chunk: string) => void;
	stdout?: (chunk: string) => void;
	seededDirectories?: readonly string[];
}

export interface DependencyBootstrapPreview {
	mode: DependencyBootstrapMode;
	targets: readonly {
		adapter: string;
		kind: BootstrapKind;
		target: string;
		repairCommand: string;
		seedable: boolean;
		strategy: BootstrapStrategy;
	}[];
}

export interface DependencyBootstrapCandidate {
	adapter: string;
	kind: BootstrapKind;
	lockfile: string;
	target: string;
	repairCommand: string;
	seedable: boolean;
}

export async function prepareDependencyBootstrap(
	mode: DependencyBootstrapMode,
	context: {
		repoRoot: string;
		currentRoot?: string;
		detectionRoot?: string;
		worktreePath: string;
		checkUvRuntime?: (target: BootstrapTarget) => Promise<boolean>;
		cargoBuildCommand?: string;
	},
): Promise<DependencyBootstrapPlan> {
	if (mode === "off") return { mode, targets: [] };

	const adapters = createBootstrapAdapters(
		context.checkUvRuntime ?? defaultCheckUvRuntime,
		context.cargoBuildCommand,
	);
	const sourceRoots: string[] = [];
	for (const sourceRoot of uniquePaths([
		context.repoRoot,
		context.currentRoot,
	])) {
		if (await isAllowedSourceRoot(context.repoRoot, sourceRoot)) {
			sourceRoots.push(sourceRoot);
		}
	}
	const targets: PlannedBootstrapTarget[] = [];
	const plannedRelativePaths = new Set<string>();

	for (const adapter of adapters) {
		if (plannedRelativePaths.has(adapter.relativePath)) continue;

		let fallback: PlannedBootstrapTarget | undefined;
		let selected: PlannedBootstrapTarget | undefined;

		for (const sourceRoot of sourceRoots) {
			const target = await adapter.detect({
				detectionRoot: context.detectionRoot,
				sourceRoot,
				worktreePath: context.worktreePath,
			});
			if (!target) continue;

			const seedable =
				mode !== "install-only" && (await adapter.canSeed(target));
			const candidate = { adapter, target, seedable };
			fallback ??= candidate;
			if (mode === "install-only" || seedable) {
				selected = candidate;
				break;
			}
		}

		const plannedTarget = selected ?? fallback;
		if (plannedTarget) {
			targets.push(plannedTarget);
			plannedRelativePaths.add(adapter.relativePath);
		}
	}

	return { mode, targets };
}

export async function detectDependencyBootstrapCandidate(context: {
	repoRoot: string;
	currentRoot?: string;
	detectionRoot?: string;
	worktreePath: string;
	checkUvRuntime?: (target: BootstrapTarget) => Promise<boolean>;
	cargoBuildCommand?: string;
}): Promise<DependencyBootstrapCandidate | null> {
	const plan = await prepareDependencyBootstrap("cow-then-repair", context);
	const planned = plan.targets[0];
	if (!planned) return null;

	return {
		adapter: planned.adapter.name,
		kind: planned.adapter.kind,
		lockfile: planned.adapter.lockfile,
		target: planned.target.relativePath,
		repairCommand: planned.target.repairCommand,
		seedable: planned.seedable,
	};
}

export function previewDependencyBootstrap(
	plan: DependencyBootstrapPlan,
): DependencyBootstrapPreview {
	return {
		mode: plan.mode,
		targets: plan.targets.map(({ adapter, target, seedable }) => ({
			adapter: adapter.output(target).adapter,
			kind: adapter.kind,
			target: adapter.output(target).target,
			repairCommand: target.repairCommand,
			seedable,
			strategy: bootstrapStrategy(plan.mode, target, seedable),
		})),
	};
}

export async function executeDependencyBootstrap(
	plan: DependencyBootstrapPlan,
	options: DependencyBootstrapDependencies & {
		repoRoot: string;
		reporter: DependencyBootstrapReporter;
	},
): Promise<DependencyBootstrapReport> {
	if (plan.mode === "off") return { mode: plan.mode, ready: true, events: [] };

	const events: BootstrapEvent[] = [];
	const cloneDirectory = options.cloneDirectory ?? cloneDir;
	const execution: BootstrapCommandExecutionContext = {
		runCommand: options.runCommand ?? runCommand,
		stderr: options.stderr ?? (() => undefined),
		stdout: options.stdout ?? ((chunk) => process.stdout.write(chunk)),
	};
	const seededDirectories = new Set(options.seededDirectories ?? []);

	if (plan.targets.length === 0) {
		recordBootstrapEvent(events, options.reporter, {
			adapter: "none",
			kind: "dependency",
			reason: "no-lockfile",
			state: "skipped",
			target: "",
			message: "no supported dependency or build-state lockfile was detected",
		});
		return { mode: plan.mode, ready: true, events };
	}

	for (const { adapter, target, seedable } of plan.targets) {
		await executeBootstrapTarget(
			adapter,
			target,
			seedable,
			plan.mode,
			cloneDirectory,
			execution,
			seededDirectories.has(target.relativePath),
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

async function executeBootstrapTarget(
	adapter: BootstrapAdapter,
	target: BootstrapTarget,
	seedable: boolean,
	mode: DependencyBootstrapMode,
	cloneDirectory: CloneDirectory,
	execution: BootstrapCommandExecutionContext,
	seededBySyncDirs: boolean,
	events: BootstrapEvent[],
	reporter: DependencyBootstrapReporter,
): Promise<void> {
	const destinationInspection = await inspectDestination(
		target.worktreePath,
		target.targetPath,
	);
	if (destinationInspection.kind === "unsafe") {
		recordBootstrapFailure(
			events,
			reporter,
			adapter,
			target,
			destinationInspection.reason,
			"destination-unsafe",
		);
		return;
	}
	if (mode === "install-only") {
		await repairTarget(
			adapter,
			target,
			execution,
			false,
			target.existingBeforeBootstrap ? "preserve" : "empty",
			events,
			reporter,
		);
		return;
	}

	let seeded = false;
	let ownership: BootstrapTargetOwnership = target.existingBeforeBootstrap
		? "preserve"
		: "empty";
	const destinationExistsNow = destinationInspection.kind === "exists";
	if (target.existingBeforeBootstrap) {
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			reason: "target-exists",
			state: "skipped",
			target: target.relativePath,
			message: "target already existed; using it as the repair input",
		});
	} else if (seededBySyncDirs && destinationExistsNow) {
		if (seedable) {
			seeded = true;
			ownership = "syncDirs";
			recordBootstrapEvent(events, reporter, {
				adapter: adapter.name,
				kind: adapter.kind,
				reason: "generic-seed",
				state: "seeded",
				target: target.relativePath,
				message: "reusing a seed created by syncDirs",
			});
		} else {
			ownership = "preserve";
			recordBootstrapEvent(events, reporter, {
				adapter: adapter.name,
				kind: adapter.kind,
				reason: "generic-seed",
				state: "fallback",
				target: target.relativePath,
				message:
					"syncDirs created a generic target; this adapter uses repair without CoW",
			});
		}
	} else if (destinationExistsNow) {
		ownership = "preserve";
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			reason: "destination-race",
			state: "skipped",
			target: target.relativePath,
			message:
				"target appeared during bootstrap; preserving it as the repair input",
		});
	} else if (seedable) {
		try {
			await cloneDirectory(adapter.seedPath(target), target.targetPath, {
				destinationRoot: target.worktreePath,
				measureBytes: reporter.measureCloneSize,
			});
			seeded = true;
			ownership = "adapter";
			recordBootstrapEvent(events, reporter, {
				adapter: adapter.name,
				kind: adapter.kind,
				state: "seeded",
				target: target.relativePath,
				message: "seeded with copy-on-write",
			});
		} catch (error) {
			if (isCloneDestinationExistsError(error)) {
				ownership = "preserve";
				recordBootstrapEvent(events, reporter, {
					adapter: adapter.name,
					kind: adapter.kind,
					state: "skipped",
					target: target.relativePath,
					message:
						"target appeared during CoW seeding; preserving it as the repair input",
				});
				await repairTarget(
					adapter,
					target,
					execution,
					false,
					ownership,
					events,
					reporter,
				);
				return;
			}
			if (isCloneInProgressError(error)) {
				recordBootstrapFailure(
					events,
					reporter,
					adapter,
					target,
					`CoW seed is already in progress: ${toErrorMessage(error)}`,
					"clone-in-progress",
				);
				return;
			}
			recordBootstrapEvent(events, reporter, {
				adapter: adapter.name,
				kind: adapter.kind,
				reason: "cow-seed-failed",
				state: "fallback",
				target: target.relativePath,
				message: `CoW seed failed; repairing from an empty target (${toErrorMessage(error)})`,
			});
		}
	} else {
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			reason: "seed-unavailable",
			state: "fallback",
			target: target.relativePath,
			message: "CoW seed is unavailable; repairing from an empty target",
		});
	}

	await repairTarget(
		adapter,
		target,
		execution,
		seeded,
		ownership,
		events,
		reporter,
	);
}

async function repairTarget(
	adapter: BootstrapAdapter,
	target: BootstrapTarget,
	execution: BootstrapCommandExecutionContext,
	seeded: boolean,
	ownership: BootstrapTargetOwnership,
	events: BootstrapEvent[],
	reporter: DependencyBootstrapReporter,
): Promise<void> {
	const beforeRepairInspection = await inspectDestination(
		target.worktreePath,
		target.targetPath,
	);
	if (beforeRepairInspection.kind === "unsafe") {
		recordBootstrapFailure(
			events,
			reporter,
			adapter,
			target,
			beforeRepairInspection.reason,
			"destination-unsafe",
		);
		return;
	}
	const presentBeforeRepair = beforeRepairInspection.kind === "exists";
	try {
		await adapter.repair(target, { ...execution, ownership });
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			state: target.repairState,
			target: target.relativePath,
			message: seeded
				? "reused and repaired"
				: "installed or repaired from a clean target",
		});
	} catch (firstError) {
		const firstFailureContext = {
			target,
			ownership,
			targetExistedBeforeRepair: presentBeforeRepair,
		};
		const cleanupError = await adapter
			.cleanupAfterRepairFailure(firstFailureContext)
			.then(() => undefined)
			.catch((error) => toErrorMessage(error));
		if (!adapter.shouldRetryAfterRepairFailure(firstFailureContext)) {
			recordBootstrapFailure(
				events,
				reporter,
				adapter,
				target,
				formatRepairFailure(
					firstError,
					cleanupError === undefined ? undefined : cleanupError,
				),
				"repair-failed",
			);
			return;
		}

		if (cleanupError) {
			recordBootstrapFailure(
				events,
				reporter,
				adapter,
				target,
				formatRepairFailure(firstError, cleanupError),
				"repair-cleanup-failed",
			);
			return;
		}
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			reason: "seed-repair-failed",
			state: "fallback",
			target: target.relativePath,
			message: `seed repair failed; removed the seed and retrying clean (${toErrorMessage(firstError)})`,
		});

		const beforeRetryInspection = await inspectDestination(
			target.worktreePath,
			target.targetPath,
		);
		if (beforeRetryInspection.kind === "unsafe") {
			recordBootstrapFailure(
				events,
				reporter,
				adapter,
				target,
				beforeRetryInspection.reason,
				"destination-unsafe",
			);
			return;
		}
		const presentBeforeRetry = beforeRetryInspection.kind === "exists";
		const retryOwnership: BootstrapTargetOwnership = presentBeforeRetry
			? "preserve"
			: "empty";
		try {
			await adapter.repair(target, { ...execution, ownership: retryOwnership });
			recordBootstrapEvent(events, reporter, {
				adapter: adapter.name,
				kind: adapter.kind,
				reason: "repair-retry",
				state: target.repairState,
				target: target.relativePath,
				message: "installed or repaired from a clean target",
			});
		} catch (secondError) {
			const cleanupError = await adapter
				.cleanupAfterRepairFailure({
					target,
					ownership: retryOwnership,
					targetExistedBeforeRepair: presentBeforeRetry,
				})
				.then(() => undefined)
				.catch((error) => toErrorMessage(error));
			recordBootstrapFailure(
				events,
				reporter,
				adapter,
				target,
				formatRepairFailure(secondError, cleanupError),
				"repair-failed",
			);
		}
	}
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

function formatRepairFailure(
	error: unknown,
	cleanupError: string | undefined,
): string {
	const message = `repair failed: ${toErrorMessage(error)}`;
	return cleanupError ? `${message}; cleanup failed: ${cleanupError}` : message;
}

function bootstrapStrategy(
	mode: DependencyBootstrapMode,
	target: BootstrapTarget,
	seedable: boolean,
): BootstrapStrategy {
	if (mode === "install-only" || target.repairState === "installed") {
		return "install-only";
	}
	return seedable ? "cow-then-repair" : "repair-only";
}

function createBootstrapAdapters(
	checkUvRuntime: (target: BootstrapTarget) => Promise<boolean>,
	cargoBuildCommand?: string,
): readonly BootstrapAdapter[] {
	return [
		new LockfileBootstrapAdapter({
			name: "pnpm",
			kind: "dependency",
			lockfile: "pnpm-lock.yaml",
			relativePath: "node_modules",
			repairCommand: "pnpm install --frozen-lockfile",
			shell: false,
			beforeRepair: async (target, context) => {
				if (!target.existingBeforeBootstrap && isDisposableSeed(context)) {
					await rm(join(target.targetPath, ".modules.yaml"), {
						force: true,
					});
				}
			},
		}),
		new LockfileBootstrapAdapter({
			name: "yarn",
			kind: "dependency",
			lockfile: "yarn.lock",
			relativePath: "node_modules",
			repairCommand: "yarn install --immutable",
			shell: false,
			beforeRepair: async (target, context) => {
				if (!target.existingBeforeBootstrap && isDisposableSeed(context)) {
					await rm(join(target.targetPath, ".yarn-state.yml"), {
						force: true,
					});
				}
			},
		}),
		new LockfileBootstrapAdapter({
			name: "npm",
			kind: "dependency",
			lockfile: "package-lock.json",
			relativePath: "node_modules",
			repairCommand: "npm ci",
			shell: false,
			seedPolicy: "never",
			repairCommandOverride: (target) =>
				target.existingBeforeBootstrap ? "npm install" : "npm ci",
			repairState: "installed",
		}),
		new LockfileBootstrapAdapter({
			name: "bundler",
			kind: "dependency",
			lockfile: "Gemfile.lock",
			relativePath: "vendor/bundle",
			repairCommand: "bundle install",
			shell: false,
			commandOptions: () => ({
				env: { BUNDLE_PATH: "vendor/bundle" },
			}),
			beforeRepair: async (target, context) => {
				if (!target.existingBeforeBootstrap && isDisposableSeed(context)) {
					await removeBundlerExtensionMarkers(target.targetPath);
				}
			},
		}),
		new LockfileBootstrapAdapter({
			name: "uv",
			kind: "dependency",
			lockfile: "uv.lock",
			relativePath: ".venv",
			repairCommand: "uv sync --locked",
			shell: false,
			canSeedOverride: checkUvRuntime,
			beforeRepair: validateUvStructure,
			afterRepair: validateUvRelocation,
		}),
		new LockfileBootstrapAdapter({
			name: "cargo",
			kind: "build-cache",
			lockfile: "Cargo.lock",
			relativePath: "target",
			repairCommand: cargoBuildCommand?.trim() || "cargo check",
			shell: cargoBuildCommand ? undefined : false,
		}),
	];
}

interface LockfileBootstrapAdapterSpec {
	name: string;
	kind: BootstrapKind;
	lockfile: string;
	relativePath: string;
	repairCommand: string;
	shell?: boolean;
	seedPolicy?: "always" | "never";
	canSeedOverride?: (target: BootstrapTarget) => Promise<boolean>;
	beforeRepair?: (
		target: BootstrapTarget,
		context: BootstrapExecutionContext,
	) => Promise<void>;
	afterRepair?: (target: BootstrapTarget) => Promise<void>;
	commandOptions?: (
		target: BootstrapTarget,
	) => Parameters<BootstrapCommandRunner>[4];
	repairCommandOverride?: (target: BootstrapTarget) => string;
	repairState?: "repaired" | "installed";
}

class LockfileBootstrapAdapter implements BootstrapAdapter {
	readonly kind: BootstrapKind;
	readonly lockfile: string;
	readonly name: string;
	readonly relativePath: string;
	private readonly defaultRepairCommand: string;
	private readonly shell?: boolean;
	private readonly seedPolicy: "always" | "never";
	private readonly canSeedOverride?: (
		target: BootstrapTarget,
	) => Promise<boolean>;
	private readonly beforeRepair?: (
		target: BootstrapTarget,
		context: BootstrapExecutionContext,
	) => Promise<void>;
	private readonly afterRepair?: (target: BootstrapTarget) => Promise<void>;
	private readonly commandOptions?: (
		target: BootstrapTarget,
	) => Parameters<BootstrapCommandRunner>[4];
	private readonly repairCommandOverride?: (target: BootstrapTarget) => string;
	private readonly repairState: "repaired" | "installed";

	constructor(spec: LockfileBootstrapAdapterSpec) {
		this.name = spec.name;
		this.kind = spec.kind;
		this.lockfile = spec.lockfile;
		this.relativePath = spec.relativePath;
		this.defaultRepairCommand = spec.repairCommand;
		this.shell = spec.shell;
		this.seedPolicy = spec.seedPolicy ?? "always";
		this.canSeedOverride = spec.canSeedOverride;
		this.beforeRepair = spec.beforeRepair;
		this.afterRepair = spec.afterRepair;
		this.commandOptions = spec.commandOptions;
		this.repairCommandOverride = spec.repairCommandOverride;
		this.repairState = spec.repairState ?? "repaired";
	}

	async detect(
		context: BootstrapPreparationContext,
	): Promise<BootstrapTarget | null> {
		const detectionRoot = context.detectionRoot ?? context.sourceRoot;
		if (!(await pathExists(join(detectionRoot, this.lockfile)))) return null;

		const sourcePath = join(context.sourceRoot, this.relativePath);
		const targetPath = join(context.worktreePath, this.relativePath);
		const destinationInspection = await inspectDestination(
			context.worktreePath,
			targetPath,
		);
		const target = {
			adapter: this.name,
			kind: this.kind,
			relativePath: this.relativePath,
			sourceRoot: context.sourceRoot,
			worktreePath: context.worktreePath,
			sourcePath,
			targetPath,
			repairCommand: this.defaultRepairCommand,
			repairState: this.repairState,
			existingBeforeBootstrap: destinationInspection.kind === "exists",
		};

		return {
			...target,
			repairCommand:
				this.repairCommandOverride?.(target) ?? target.repairCommand,
		};
	}

	seedPath(target: BootstrapTarget): string {
		return target.sourcePath;
	}

	async repair(
		target: BootstrapTarget,
		context: BootstrapExecutionContext,
	): Promise<void> {
		await this.beforeRepair?.(target, context);
		await context.runCommand(
			target.repairCommand,
			target.worktreePath,
			context.stderr,
			context.stdout,
			{
				...this.commandOptions?.(target),
				shell: this.shell,
			},
		);
		await this.afterRepair?.(target);
	}

	async canSeed(target: BootstrapTarget): Promise<boolean> {
		if (this.seedPolicy === "never") return false;
		if (!(await safeSourceDirectory(target))) return false;
		return (await this.canSeedOverride?.(target)) ?? true;
	}

	output(target: BootstrapTarget): BootstrapOutputMetadata {
		return {
			adapter: this.name,
			kind: this.kind,
			target: target.relativePath,
			repairCommand: target.repairCommand,
		};
	}

	shouldRetryAfterRepairFailure(
		context: BootstrapRepairFailureContext,
	): boolean {
		return isDisposableSeed(context);
	}

	async cleanupAfterRepairFailure(
		context: BootstrapRepairFailureContext,
	): Promise<void> {
		if (context.target.existingBeforeBootstrap) {
			return;
		}
		if (isDisposableSeed(context)) {
			await rm(context.target.targetPath, { force: true, recursive: true });
			return;
		}
		if (context.ownership === "empty" && !context.targetExistedBeforeRepair) {
			await rm(context.target.targetPath, { force: true, recursive: true });
		}
	}
}

function isDisposableSeed(
	context: Pick<BootstrapRepairFailureContext, "ownership">,
): boolean {
	return context.ownership === "adapter" || context.ownership === "syncDirs";
}

async function safeSourceDirectory(target: BootstrapTarget): Promise<boolean> {
	try {
		const [root, source] = await Promise.all([
			realpath(target.sourceRoot),
			realpath(target.sourcePath),
		]);
		const sourceStats = await lstat(source);
		return sourceStats.isDirectory() && isWithin(root, source);
	} catch {
		return false;
	}
}

async function defaultCheckUvRuntime(
	target: BootstrapTarget,
): Promise<boolean> {
	try {
		const config = await readFile(
			join(target.sourcePath, "pyvenv.cfg"),
			"utf8",
		);
		const expected = config.match(/^version(?:_info)?\s*=\s*(\d+\.\d+)/mu)?.[1];
		if (!expected) return false;
		const expectedImplementation = config
			.match(/^implementation\s*=\s*([^\s#]+)/imu)?.[1]
			?.toLowerCase();

		const sourceInterpreter = join(
			target.sourcePath,
			process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
		);
		const fingerprintScript =
			"import platform, sys; print(f'{sys.version_info.major}.{sys.version_info.minor}|{platform.machine()}|{sys.implementation.name}')";
		const source = await execFileAsync(sourceInterpreter, [
			"-c",
			fingerprintScript,
		]);
		const sourceFingerprint = source.stdout.trim();
		const [sourceVersion, sourceMachine, sourceImplementation, extra] =
			sourceFingerprint.split("|");
		return (
			extra === undefined &&
			sourceVersion === expected &&
			Boolean(sourceMachine) &&
			Boolean(sourceImplementation) &&
			(expectedImplementation === undefined ||
				sourceImplementation.toLowerCase() === expectedImplementation)
		);
	} catch {
		return false;
	}
}

function virtualEnvironmentPrefixes(text: string): string[] {
	const prefixes: string[] = [];
	for (const line of text.split(/\r?\n/u)) {
		if (!/\bVIRTUAL_ENV\b/u.test(line)) continue;
		for (const match of line.matchAll(/["']([^"']+)["']/gu)) {
			if (match[1] && isAbsolute(match[1])) prefixes.push(match[1]);
		}
		const unquoted = line.match(/\bVIRTUAL_ENV(?:\s*=|\s+)\s*([^\s"']+)/u)?.[1];
		if (unquoted && isAbsolute(unquoted)) prefixes.push(unquoted);
	}
	return uniquePaths(prefixes);
}

function pythonPrefixFromShebang(text: string): string | undefined {
	const command = text
		.match(/^#!\s*([^\r\n]+)/u)?.[1]
		?.trim()
		.split(/\s+/u)[0];
	if (!command || !isAbsolute(command)) return undefined;
	if (
		!/^python(?:\d+(?:\.\d+)?)?(?:\.exe)?$/iu.test(
			command.split(sep).at(-1) ?? "",
		)
	) {
		return undefined;
	}
	return dirname(dirname(command));
}

function pythonPrefixesFromText(text: string): string[] {
	const interpreters: string[] = [];
	for (const match of text.matchAll(/["'](\/[^"']+)["']/gu)) {
		if (match[1]) interpreters.push(match[1]);
	}
	for (const match of text.matchAll(/(?:^|\s)(\/[^\s"']+)/gmu)) {
		if (match[1]) interpreters.push(match[1]);
	}
	return uniquePaths(
		interpreters.flatMap((interpreter) => {
			const name = interpreter.split(sep).at(-1) ?? "";
			return /^python(?:\d+(?:\.\d+)?)?(?:\.exe)?$/iu.test(name)
				? [dirname(dirname(interpreter))]
				: [];
		}),
	);
}

async function validateUvRelocation(target: BootstrapTarget): Promise<void> {
	if (target.existingBeforeBootstrap) return;

	const scriptsDirectory = join(
		target.targetPath,
		process.platform === "win32" ? "Scripts" : "bin",
	);
	const interpreter = join(
		scriptsDirectory,
		process.platform === "win32" ? "python.exe" : "python",
	);
	const { stdout } = await execFileAsync(interpreter, [
		"-c",
		"import os, sys; print(os.path.realpath(sys.prefix))",
	]);
	const [actualPrefix, expectedPrefix] = await Promise.all([
		realpath(stdout.trim()),
		realpath(target.targetPath),
	]);
	if (actualPrefix !== expectedPrefix) {
		throw new Error(
			`uv environment still points to its source prefix: ${actualPrefix}`,
		);
	}

	const sourcePaths = uniquePaths([
		target.sourcePath,
		await realpath(target.sourcePath).catch(() => undefined),
	]);
	const entries = await readdir(scriptsDirectory, { withFileTypes: true });
	assertSafeUvScriptEntries(entries);
	const environmentName = basename(target.targetPath);
	const acceptedPrefixes = new Set([
		resolve(target.targetPath),
		await realpath(target.targetPath),
	]);
	for (const path of [
		join(target.targetPath, "pyvenv.cfg"),
		...entries
			.filter((entry) => entry.isFile())
			.map((entry) => join(scriptsDirectory, entry.name)),
	]) {
		const contents = await readFile(path).catch(() => undefined);
		if (!contents) continue;
		const text = contents.toString("utf8");
		if (!Buffer.from(text, "utf8").equals(contents)) continue;
		if (sourcePaths.some((sourcePath) => text.includes(sourcePath))) {
			throw new Error(`uv environment contains a stale source path: ${path}`);
		}
		const shebangPrefix = pythonPrefixFromShebang(text);
		if (
			shebangPrefix &&
			basename(shebangPrefix) === environmentName &&
			!acceptedPrefixes.has(resolve(shebangPrefix))
		) {
			throw new Error(`uv launcher points outside its environment: ${path}`);
		}
		if (
			pythonPrefixesFromText(text)
				.filter((prefix) => basename(prefix) === environmentName)
				.some((prefix) => !acceptedPrefixes.has(resolve(prefix)))
		) {
			throw new Error(`uv launcher points outside its environment: ${path}`);
		}
		if (
			virtualEnvironmentPrefixes(text).some(
				(prefix) => !acceptedPrefixes.has(resolve(prefix)),
			)
		) {
			throw new Error(
				`uv activation script points outside its environment: ${path}`,
			);
		}
	}
}

async function validateUvStructure(target: BootstrapTarget): Promise<void> {
	if (target.existingBeforeBootstrap) return;
	const targetStats = await lstat(target.targetPath).catch(() => undefined);
	if (!targetStats) return;
	if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
		throw new Error("uv environment must be a real directory");
	}

	const configStats = await lstat(join(target.targetPath, "pyvenv.cfg")).catch(
		() => undefined,
	);
	if (configStats && (!configStats.isFile() || configStats.isSymbolicLink())) {
		throw new Error("uv pyvenv.cfg must be a regular file");
	}

	const scriptsDirectory = join(
		target.targetPath,
		process.platform === "win32" ? "Scripts" : "bin",
	);
	const scriptsStats = await lstat(scriptsDirectory).catch(() => undefined);
	if (!scriptsStats) return;
	if (!scriptsStats.isDirectory() || scriptsStats.isSymbolicLink()) {
		throw new Error("uv scripts path must be a real directory");
	}
	assertSafeUvScriptEntries(
		await readdir(scriptsDirectory, { withFileTypes: true }),
	);
}

function assertSafeUvScriptEntries(entries: readonly Dirent[]): void {
	for (const entry of entries) {
		if (entry.isSymbolicLink() && !isUvInterpreterName(entry.name)) {
			throw new Error(`uv script must not be a symbolic link: ${entry.name}`);
		}
	}
}

function isUvInterpreterName(name: string): boolean {
	return /^python(?:\d+(?:\.\d+)?)?(?:\.exe)?$/iu.test(name);
}

async function removeBundlerExtensionMarkers(root: string): Promise<void> {
	const pending = [root];
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) continue;
		let entries: Dirent[];
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) pending.push(path);
			else if (entry.isFile() && isBundlerExtensionMarker(root, path)) {
				await rm(path, { force: true });
			}
		}
	}
}

function isBundlerExtensionMarker(root: string, path: string): boolean {
	const segments = relative(root, path).split(sep);
	return (
		segments.length >= 7 &&
		segments[0] === "ruby" &&
		segments[2] === "extensions" &&
		segments.at(-1) === "gem.build_complete"
	);
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
