import { execFile } from "node:child_process";
import { access, lstat, readFile, realpath, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
	type CloneFailureStore,
	defaultCloneFailureStore,
} from "./clone-failure-store.js";
import type { DependencyBootstrapMode } from "./config.js";
import {
	type CloneDirectory,
	cloneDir,
	isCloneUnsupportedError,
} from "./dir-clone.js";
import type { SyncDirectoryReporter } from "./sync-directories.js";

const execFileAsync = promisify(execFile);

export type BootstrapKind = "dependency" | "build-cache";
export type BootstrapState =
	| "seeded"
	| "repaired"
	| "installed"
	| "fallback"
	| "skipped"
	| "failed";

export type BootstrapCommandRunner = (
	command: string,
	cwd: string,
	stderr: (chunk: string) => void,
) => Promise<void>;

export interface BootstrapContext {
	repoRoot: string;
	sourceRoot: string;
	worktreePath: string;
	runCommand: BootstrapCommandRunner;
	stderr: (chunk: string) => void;
	checkUvRuntime?: (target: BootstrapTarget) => Promise<boolean>;
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
	runCommand: BootstrapCommandRunner;
	stderr: (chunk: string) => void;
}

export interface BootstrapAdapter {
	readonly kind: BootstrapKind;
	readonly name: string;
	detect(context: BootstrapContext): Promise<BootstrapTarget | null>;
	seedPath(target: BootstrapTarget): string;
	repair(target: BootstrapTarget): Promise<void>;
	canSeed(target: BootstrapTarget): Promise<boolean>;
}

export interface DependencyBootstrapPlan {
	mode: DependencyBootstrapMode;
	targets: readonly PlannedBootstrapTarget[];
}

export interface PlannedBootstrapTarget {
	adapter: BootstrapAdapter;
	target: BootstrapTarget;
}

export interface BootstrapEvent {
	adapter: string;
	kind: BootstrapKind;
	state: BootstrapState;
	target: string;
	message: string;
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
	checkUvRuntime?: (target: BootstrapTarget) => Promise<boolean>;
}

export interface DependencyBootstrapPreview {
	mode: DependencyBootstrapMode;
	targets: readonly {
		adapter: string;
		kind: BootstrapKind;
		target: string;
		repairCommand: string;
		strategy: "cow-then-repair" | "install-only";
	}[];
}

export async function prepareDependencyBootstrap(
	mode: DependencyBootstrapMode,
	context: Omit<BootstrapContext, "sourceRoot"> & { currentRoot?: string },
): Promise<DependencyBootstrapPlan> {
	if (mode === "off") return { mode, targets: [] };

	const adapters = createBootstrapAdapters(
		context.checkUvRuntime ?? defaultCheckUvRuntime,
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

	for (const adapter of adapters) {
		let firstCandidate: BootstrapTarget | null = null;
		for (const sourceRoot of sourceRoots) {
			const target = await adapter.detect({ ...context, sourceRoot });
			if (!target) continue;
			firstCandidate ??= target;
			if (mode === "install-only" || (await adapter.canSeed(target))) {
				targets.push({ adapter, target });
				break;
			}
		}
		if (
			firstCandidate &&
			!targets.some(({ adapter: selected }) => selected === adapter)
		) {
			targets.push({ adapter, target: firstCandidate });
		}
	}

	return { mode, targets };
}

export function previewDependencyBootstrap(
	plan: DependencyBootstrapPlan,
): DependencyBootstrapPreview {
	return {
		mode: plan.mode,
		targets: plan.targets.map(({ adapter, target }) => ({
			adapter: adapter.name,
			kind: adapter.kind,
			target: target.relativePath,
			repairCommand: target.repairCommand,
			strategy:
				plan.mode === "install-only" ? "install-only" : "cow-then-repair",
		})),
	};
}

export async function executeDependencyBootstrap(
	plan: DependencyBootstrapPlan,
	options: DependencyBootstrapDependencies & {
		repoRoot: string;
		reporter: SyncDirectoryReporter;
	},
): Promise<DependencyBootstrapReport> {
	if (plan.mode === "off") return { mode: plan.mode, ready: true, events: [] };

	const events: BootstrapEvent[] = [];
	const failureStore = options.failureStore ?? defaultCloneFailureStore;
	const cloneDirectory = options.cloneDirectory ?? cloneDir;

	if (plan.targets.length === 0) {
		recordBootstrapEvent(events, options.reporter, {
			adapter: "none",
			kind: "dependency",
			state: "skipped",
			target: "",
			message: "no supported dependency or build-state lockfile was detected",
		});
		return { mode: plan.mode, ready: true, events };
	}

	for (const { adapter, target } of plan.targets) {
		if (options.runCommand) target.runCommand = options.runCommand;
		await executeBootstrapTarget(
			adapter,
			target,
			plan.mode,
			cloneDirectory,
			failureStore,
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
	mode: DependencyBootstrapMode,
	cloneDirectory: CloneDirectory,
	failureStore: CloneFailureStore,
	events: BootstrapEvent[],
	reporter: SyncDirectoryReporter,
	repoRoot: string,
): Promise<void> {
	if (mode === "install-only") {
		await repairTarget(adapter, target, false, events, reporter);
		return;
	}

	let seeded = false;
	if (target.existingBeforeBootstrap) {
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			state: "skipped",
			target: target.relativePath,
			message: "target already existed; using it as the repair input",
		});
	} else if (await pathExists(target.targetPath)) {
		seeded = true;
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			state: "seeded",
			target: target.relativePath,
			message: "reusing a seed created by syncDirs",
		});
	} else if (await failureStore.isCached(repoRoot, target.relativePath)) {
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			state: "fallback",
			target: target.relativePath,
			message: "previous CoW failure is cached; repairing from an empty target",
		});
	} else if (await adapter.canSeed(target)) {
		try {
			await cloneDirectory(adapter.seedPath(target), target.targetPath, {
				measureBytes: reporter.measureCloneSize,
			});
			await failureStore.clear(repoRoot, target.relativePath);
			seeded = true;
			recordBootstrapEvent(events, reporter, {
				adapter: adapter.name,
				kind: adapter.kind,
				state: "seeded",
				target: target.relativePath,
				message: "seeded with copy-on-write",
			});
		} catch (error) {
			if (isCloneUnsupportedError(error)) {
				await failureStore.cache(
					repoRoot,
					target.relativePath,
					toErrorMessage(error),
				);
			}
			await removeCreatedTarget(target, true);
			recordBootstrapEvent(events, reporter, {
				adapter: adapter.name,
				kind: adapter.kind,
				state: "fallback",
				target: target.relativePath,
				message: `CoW seed failed; repairing from an empty target (${toErrorMessage(error)})`,
			});
		}
	} else {
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			state: "fallback",
			target: target.relativePath,
			message: "CoW seed is unavailable; repairing from an empty target",
		});
	}

	await repairTarget(adapter, target, seeded, events, reporter);
}

async function repairTarget(
	adapter: BootstrapAdapter,
	target: BootstrapTarget,
	seeded: boolean,
	events: BootstrapEvent[],
	reporter: SyncDirectoryReporter,
): Promise<void> {
	try {
		await adapter.repair(target);
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
		if (target.existingBeforeBootstrap) {
			recordBootstrapEvent(events, reporter, {
				adapter: adapter.name,
				kind: adapter.kind,
				state: "failed",
				target: target.relativePath,
				message: `repair failed: ${toErrorMessage(firstError)}`,
			});
			return;
		}
		if (!seeded) {
			await removeCreatedTarget(target, true);
			recordBootstrapEvent(events, reporter, {
				adapter: adapter.name,
				kind: adapter.kind,
				state: "failed",
				target: target.relativePath,
				message: `repair failed: ${toErrorMessage(firstError)}`,
			});
			return;
		}

		await removeCreatedTarget(target, true);
		recordBootstrapEvent(events, reporter, {
			adapter: adapter.name,
			kind: adapter.kind,
			state: "fallback",
			target: target.relativePath,
			message: `seed repair failed; removed the seed and retrying clean (${toErrorMessage(firstError)})`,
		});

		try {
			await adapter.repair(target);
			recordBootstrapEvent(events, reporter, {
				adapter: adapter.name,
				kind: adapter.kind,
				state: target.repairState,
				target: target.relativePath,
				message: "installed or repaired from a clean target",
			});
		} catch (secondError) {
			await removeCreatedTarget(target, true);
			recordBootstrapEvent(events, reporter, {
				adapter: adapter.name,
				kind: adapter.kind,
				state: "failed",
				target: target.relativePath,
				message: `clean repair failed: ${toErrorMessage(secondError)}`,
			});
		}
	}
}

function recordBootstrapEvent(
	events: BootstrapEvent[],
	reporter: SyncDirectoryReporter,
	event: BootstrapEvent,
): void {
	events.push(event);
	reporter.dependency?.(event);
}

async function removeCreatedTarget(
	target: BootstrapTarget,
	createdByBootstrap: boolean,
): Promise<void> {
	if (target.existingBeforeBootstrap || !createdByBootstrap) return;
	await rm(target.targetPath, { force: true, recursive: true });
}

function createBootstrapAdapters(
	checkUvRuntime: ((target: BootstrapTarget) => Promise<boolean>) | undefined,
): readonly BootstrapAdapter[] {
	return [
		new LockfileBootstrapAdapter(
			"pnpm",
			"dependency",
			"pnpm-lock.yaml",
			"pnpm install --frozen-lockfile",
			{
				beforeRepair: async (target) => {
					if (!target.existingBeforeBootstrap) {
						await rm(join(target.targetPath, ".modules.yaml"), {
							force: true,
						});
					}
				},
			},
		),
		new LockfileBootstrapAdapter(
			"yarn",
			"dependency",
			"yarn.lock",
			"yarn install --immutable",
		),
		new LockfileBootstrapAdapter(
			"npm",
			"dependency",
			"package-lock.json",
			"npm ci",
			{
				canSeed: async () => false,
				repairCommand: (target) =>
					target.existingBeforeBootstrap ? "npm install" : "npm ci",
				repairState: "installed",
			},
		),
		new LockfileBootstrapAdapter(
			"uv",
			"dependency",
			"uv.lock",
			"uv sync --locked",
			{
				canSeed: checkUvRuntime,
			},
		),
		new LockfileBootstrapAdapter(
			"cargo",
			"build-cache",
			"Cargo.lock",
			"cargo check",
		),
	];
}

class LockfileBootstrapAdapter implements BootstrapAdapter {
	readonly kind: BootstrapKind;
	readonly name: string;
	private readonly lockfile: string;
	private readonly defaultRepairCommand: string;
	private readonly canSeedOverride?: (
		target: BootstrapTarget,
	) => Promise<boolean>;
	private readonly beforeRepair?: (target: BootstrapTarget) => Promise<void>;
	private readonly repairCommandOverride?: (target: BootstrapTarget) => string;
	private readonly repairState: "repaired" | "installed";

	constructor(
		name: string,
		kind: BootstrapKind,
		lockfile: string,
		repairCommand: string,
		options: {
			canSeed?: (target: BootstrapTarget) => Promise<boolean>;
			beforeRepair?: (target: BootstrapTarget) => Promise<void>;
			repairCommand?: (target: BootstrapTarget) => string;
			repairState?: "repaired" | "installed";
		} = {},
	) {
		this.name = name;
		this.kind = kind;
		this.lockfile = lockfile;
		this.defaultRepairCommand = repairCommand;
		this.canSeedOverride = options.canSeed;
		this.beforeRepair = options.beforeRepair;
		this.repairCommandOverride = options.repairCommand;
		this.repairState = options.repairState ?? "repaired";
	}

	async detect(context: BootstrapContext): Promise<BootstrapTarget | null> {
		if (!(await pathExists(join(context.sourceRoot, this.lockfile))))
			return null;
		const relativePath =
			this.name === "cargo"
				? "target"
				: this.name === "uv"
					? ".venv"
					: "node_modules";
		const targetPath = join(context.worktreePath, relativePath);

		return {
			adapter: this.name,
			kind: this.kind,
			relativePath,
			sourceRoot: context.sourceRoot,
			worktreePath: context.worktreePath,
			sourcePath: join(context.sourceRoot, relativePath),
			targetPath,
			repairCommand:
				this.repairCommandOverride?.({
					adapter: this.name,
					kind: this.kind,
					relativePath,
					sourceRoot: context.sourceRoot,
					worktreePath: context.worktreePath,
					sourcePath: join(context.sourceRoot, relativePath),
					targetPath,
					repairCommand: this.defaultRepairCommand,
					repairState: this.repairState,
					existingBeforeBootstrap: await pathExists(targetPath),
					runCommand: context.runCommand,
					stderr: context.stderr,
				}) ?? this.defaultRepairCommand,
			repairState: this.repairState,
			existingBeforeBootstrap: await pathExists(targetPath),
			runCommand: context.runCommand,
			stderr: context.stderr,
		};
	}

	seedPath(target: BootstrapTarget): string {
		return target.sourcePath;
	}

	async repair(target: BootstrapTarget): Promise<void> {
		await this.beforeRepair?.(target);
		await target.runCommand(
			target.repairCommand,
			target.worktreePath,
			target.stderr,
		);
	}

	async canSeed(target: BootstrapTarget): Promise<boolean> {
		if (this.canSeedOverride) {
			return (
				(await safeSourceDirectory(target)) &&
				(await this.canSeedOverride(target))
			);
		}
		return safeSourceDirectory(target);
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
		const { stdout, stderr } = await execFileAsync("python3", ["--version"]);
		const actual = `${stdout}${stderr}`.match(/Python\s+(\d+\.\d+)/u)?.[1];
		return actual === expected;
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
