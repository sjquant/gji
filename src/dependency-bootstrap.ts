import { execFile } from "node:child_process";
import { access, lstat, readFile, realpath, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
	type CloneFailureStore,
	cloneFailureScope,
	defaultCloneFailureStore,
} from "./clone-failure-store.js";
import { type CommandRunner, runCommand } from "./command-runner.js";
import type { DependencyBootstrapMode } from "./config.js";
import {
	type CloneDirectory,
	cloneDir,
	isCloneDestinationExistsError,
	isCloneInProgressError,
	isCloneUnsupportedError,
} from "./dir-clone.js";

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
	sourceRoot: string;
	worktreePath: string;
}

export interface BootstrapExecutionContext {
	runCommand: BootstrapCommandRunner;
	stderr: (chunk: string) => void;
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

export interface BootstrapAdapter {
	readonly kind: BootstrapKind;
	readonly name: string;
	readonly relativePath: string;
	detect(context: BootstrapPreparationContext): Promise<BootstrapTarget | null>;
	seedPath(target: BootstrapTarget): string;
	repair(
		target: BootstrapTarget,
		context: BootstrapExecutionContext,
	): Promise<void>;
	canSeed(target: BootstrapTarget): Promise<boolean>;
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
	failureStore?: CloneFailureStore;
	runCommand?: BootstrapCommandRunner;
	stderr?: (chunk: string) => void;
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

export async function prepareDependencyBootstrap(
	mode: DependencyBootstrapMode,
	context: {
		repoRoot: string;
		currentRoot?: string;
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

export function previewDependencyBootstrap(
	plan: DependencyBootstrapPlan,
): DependencyBootstrapPreview {
	return {
		mode: plan.mode,
		targets: plan.targets.map(({ adapter, target, seedable }) => ({
			adapter: adapter.name,
			kind: adapter.kind,
			target: target.relativePath,
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
	const failureStore = options.failureStore ?? defaultCloneFailureStore;
	const cloneDirectory = options.cloneDirectory ?? cloneDir;
	const execution: BootstrapExecutionContext = {
		runCommand: options.runCommand ?? runCommand,
		stderr: options.stderr ?? (() => undefined),
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
			failureStore,
			execution,
			seededDirectories.has(target.relativePath),
			events,
			options.reporter,
			options.repoRoot,
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
	failureStore: CloneFailureStore,
	execution: BootstrapExecutionContext,
	seededBySyncDirs: boolean,
	events: BootstrapEvent[],
	reporter: DependencyBootstrapReporter,
	repoRoot: string,
): Promise<void> {
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
	const failureScope = seedable
		? await cloneFailureScope(adapter.seedPath(target), target.targetPath)
		: undefined;
	let ownership: BootstrapTargetOwnership = target.existingBeforeBootstrap
		? "preserve"
		: "empty";
	if (target.existingBeforeBootstrap) {
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			reason: "target-exists",
			state: "skipped",
			target: target.relativePath,
			message: "target already existed; using it as the repair input",
		});
	} else if (seededBySyncDirs && (await pathExists(target.targetPath))) {
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
	} else if (await pathExists(target.targetPath)) {
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
	} else if (
		seedable &&
		(await failureStore.isCached(repoRoot, target.relativePath, failureScope))
	) {
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			reason: "cow-failure-cached",
			state: "fallback",
			target: target.relativePath,
			message: "previous CoW failure is cached; repairing from an empty target",
		});
	} else if (seedable) {
		try {
			await cloneDirectory(adapter.seedPath(target), target.targetPath, {
				measureBytes: reporter.measureCloneSize,
			});
			await failureStore.clear(repoRoot, target.relativePath, failureScope);
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
			if (isCloneUnsupportedError(error)) {
				await failureStore.cache(
					repoRoot,
					target.relativePath,
					toErrorMessage(error),
					failureScope,
				);
			}
			recordBootstrapEvent(events, reporter, {
				adapter: adapter.name,
				kind: adapter.kind,
				reason: "cow-unsupported",
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

type BootstrapTargetOwnership = "adapter" | "syncDirs" | "empty" | "preserve";

async function repairTarget(
	adapter: BootstrapAdapter,
	target: BootstrapTarget,
	execution: BootstrapExecutionContext,
	seeded: boolean,
	ownership: BootstrapTargetOwnership,
	events: BootstrapEvent[],
	reporter: DependencyBootstrapReporter,
): Promise<void> {
	const presentBeforeRepair = await pathExists(target.targetPath);
	try {
		await adapter.repair(target, execution);
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
		if (ownership !== "adapter" && ownership !== "syncDirs") {
			if (!presentBeforeRepair) await removeTarget(target);
			recordBootstrapFailure(
				events,
				reporter,
				adapter,
				target,
				`repair failed: ${toErrorMessage(firstError)}`,
				"repair-failed",
			);
			return;
		}

		await removeTarget(target);
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			reason: "seed-repair-failed",
			state: "fallback",
			target: target.relativePath,
			message: `seed repair failed; removed the seed and retrying clean (${toErrorMessage(firstError)})`,
		});

		const presentBeforeRetry = await pathExists(target.targetPath);
		try {
			await adapter.repair(target, execution);
			recordBootstrapEvent(events, reporter, {
				adapter: adapter.name,
				kind: adapter.kind,
				reason: "repair-retry",
				state: target.repairState,
				target: target.relativePath,
				message: "installed or repaired from a clean target",
			});
		} catch (secondError) {
			if (!presentBeforeRetry) await removeTarget(target);
			recordBootstrapFailure(
				events,
				reporter,
				adapter,
				target,
				`clean repair failed: ${toErrorMessage(secondError)}`,
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

async function removeTarget(target: BootstrapTarget): Promise<void> {
	if (!target.existingBeforeBootstrap) {
		await rm(target.targetPath, { force: true, recursive: true });
	}
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
			beforeRepair: async (target) => {
				if (!target.existingBeforeBootstrap) {
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
		}),
		new LockfileBootstrapAdapter({
			name: "npm",
			kind: "dependency",
			lockfile: "package-lock.json",
			relativePath: "node_modules",
			repairCommand: "npm ci",
			seedPolicy: "never",
			repairCommandOverride: (target) =>
				target.existingBeforeBootstrap ? "npm install" : "npm ci",
			repairState: "installed",
		}),
		new LockfileBootstrapAdapter({
			name: "uv",
			kind: "dependency",
			lockfile: "uv.lock",
			relativePath: ".venv",
			repairCommand: "uv sync --locked",
			canSeedOverride: checkUvRuntime,
		}),
		new LockfileBootstrapAdapter({
			name: "cargo",
			kind: "build-cache",
			lockfile: "Cargo.lock",
			relativePath: "target",
			repairCommand: cargoBuildCommand?.trim() || "cargo check",
		}),
	];
}

interface LockfileBootstrapAdapterSpec {
	name: string;
	kind: BootstrapKind;
	lockfile: string;
	relativePath: string;
	repairCommand: string;
	seedPolicy?: "always" | "never";
	canSeedOverride?: (target: BootstrapTarget) => Promise<boolean>;
	beforeRepair?: (target: BootstrapTarget) => Promise<void>;
	repairCommandOverride?: (target: BootstrapTarget) => string;
	repairState?: "repaired" | "installed";
}

class LockfileBootstrapAdapter implements BootstrapAdapter {
	readonly kind: BootstrapKind;
	readonly name: string;
	readonly relativePath: string;
	private readonly lockfile: string;
	private readonly defaultRepairCommand: string;
	private readonly seedPolicy: "always" | "never";
	private readonly canSeedOverride?: (
		target: BootstrapTarget,
	) => Promise<boolean>;
	private readonly beforeRepair?: (target: BootstrapTarget) => Promise<void>;
	private readonly repairCommandOverride?: (target: BootstrapTarget) => string;
	private readonly repairState: "repaired" | "installed";

	constructor(spec: LockfileBootstrapAdapterSpec) {
		this.name = spec.name;
		this.kind = spec.kind;
		this.lockfile = spec.lockfile;
		this.relativePath = spec.relativePath;
		this.defaultRepairCommand = spec.repairCommand;
		this.seedPolicy = spec.seedPolicy ?? "always";
		this.canSeedOverride = spec.canSeedOverride;
		this.beforeRepair = spec.beforeRepair;
		this.repairCommandOverride = spec.repairCommandOverride;
		this.repairState = spec.repairState ?? "repaired";
	}

	async detect(
		context: BootstrapPreparationContext,
	): Promise<BootstrapTarget | null> {
		if (!(await pathExists(join(context.sourceRoot, this.lockfile))))
			return null;

		const sourcePath = join(context.sourceRoot, this.relativePath);
		const targetPath = join(context.worktreePath, this.relativePath);
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
			existingBeforeBootstrap: await pathExists(targetPath),
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
		await this.beforeRepair?.(target);
		await context.runCommand(
			target.repairCommand,
			target.worktreePath,
			context.stderr,
		);
	}

	async canSeed(target: BootstrapTarget): Promise<boolean> {
		if (this.seedPolicy === "never") return false;
		if (!(await safeSourceDirectory(target))) return false;
		return (await this.canSeedOverride?.(target)) ?? true;
	}
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
		const expected = config.match(/^version\s*=\s*(\d+\.\d+)/mu)?.[1];
		if (!expected) return false;

		const sourceInterpreter = join(
			target.sourcePath,
			process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
		);
		const fingerprintScript =
			"import platform, sys; print(f'{sys.version_info.major}.{sys.version_info.minor}|{platform.machine()}|{sys.implementation.cache_tag}')";
		const [source, current] = await Promise.all([
			execFileAsync(sourceInterpreter, ["-c", fingerprintScript]),
			execFileAsync("python3", ["-c", fingerprintScript]),
		]);
		const sourceFingerprint = source.stdout.trim();
		const currentFingerprint = current.stdout.trim();
		return (
			sourceFingerprint === currentFingerprint &&
			sourceFingerprint.startsWith(`${expected}|`)
		);
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

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
