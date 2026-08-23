import type { EffectiveGjiConfig } from "./config.js";
import type { CommandRunner } from "./process.js";

export type BootstrapKind = "dependency" | "build-cache" | "sync-file";
export type BootstrapState = "installed" | "failed";
export type DependencyBootstrapMode = "off" | "install";

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

export interface DependencyBootstrapPreview {
	mode: DependencyBootstrapMode;
	targets: readonly {
		adapter: string;
		kind: BootstrapKind;
		target: string;
		command: string;
	}[];
}

export interface DependencyBootstrapPreviewContext {
	repoRoot: string;
	currentRoot?: string;
	worktreePath: string;
	cargoBuildCommand?: string;
}

export interface DependencyBootstrapPort {
	resolveMode(
		dependencyBootstrap: "off" | undefined,
		noInstall?: boolean,
	): DependencyBootstrapMode;
	preview(
		mode: DependencyBootstrapMode,
		context: DependencyBootstrapPreviewContext,
	): Promise<DependencyBootstrapPreview>;
}

export interface WorktreeBootstrapOptions {
	branch: string;
	config: EffectiveGjiConfig;
	currentRoot?: string;
	dependencyDetectionRoot?: string;
	dependencyMode: DependencyBootstrapMode;
	runCommand?: CommandRunner;
	commandStdout?: (chunk: string) => void;
	commandStderr?: (chunk: string) => void;
	repoRoot: string;
	reporter: DependencyBootstrapReporter;
	worktreePath: string;
}

export interface WorktreeBootstrapResult {
	dependencyBootstrap: DependencyBootstrapReport;
	ready: boolean;
	syncFileFailures: readonly BootstrapEvent[];
}

export interface WorktreeBootstrapPort {
	bootstrapWorktree(
		options: WorktreeBootstrapOptions,
	): Promise<WorktreeBootstrapResult>;
}
