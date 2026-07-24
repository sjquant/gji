import { isCancel, select } from "@clack/prompts";
import {
	type DependencyBootstrapMode,
	type EffectiveGjiConfig,
	updateGlobalRepoConfigKey,
	updateLocalConfigKey,
} from "./config.js";
import {
	type DependencyBootstrapCandidate,
	detectDependencyBootstrapCandidate,
} from "./dependency-bootstrap.js";
import { isHeadless } from "./headless.js";

export interface DependencyBootstrapPromptDependencies {
	promptForDependencyBootstrap?: (
		candidate: DependencyBootstrapCandidate,
	) => Promise<DependencyBootstrapMode | null>;
	writeConfigKey?: (root: string, key: string, value: unknown) => Promise<void>;
	writeGlobalRepoConfigKey?: (
		repoRoot: string,
		key: string,
		value: unknown,
	) => Promise<void>;
}

export interface DependencyBootstrapPolicyResolution {
	mode: DependencyBootstrapMode;
	prompted: boolean;
	source: "explicit" | "prompted" | "default" | "legacy";
}

export async function resolveDependencyBootstrapPolicy(
	context: {
		repoRoot: string;
		currentRoot?: string;
		detectionRoot?: string;
		worktreePath: string;
	},
	config: EffectiveGjiConfig,
	dependencyBootstrapExplicit: boolean,
	options: {
		dryRun?: boolean;
		legacyInstallPromptConfigured?: boolean;
		nonInteractive?: boolean;
		stderr: (chunk: string) => void;
		dependencies?: DependencyBootstrapPromptDependencies;
	},
): Promise<DependencyBootstrapPolicyResolution> {
	if (dependencyBootstrapExplicit) {
		return {
			mode: config.dependencyBootstrap ?? "off",
			prompted: false,
			source: "explicit",
		};
	}

	if (options.dryRun || options.nonInteractive || isHeadless()) {
		return { mode: "off", prompted: false, source: "default" };
	}

	if (
		options.legacyInstallPromptConfigured &&
		!options.dependencies?.promptForDependencyBootstrap
	) {
		return { mode: "off", prompted: false, source: "legacy" };
	}

	let candidate: DependencyBootstrapCandidate | null;
	try {
		candidate = await detectDependencyBootstrapCandidate(context);
	} catch (error) {
		options.stderr(
			`gji: dependency setup detection failed: ${toErrorMessage(error)}\n`,
		);
		return { mode: "off", prompted: false, source: "default" };
	}

	if (!candidate) return { mode: "off", prompted: false, source: "default" };

	const prompt =
		options.dependencies?.promptForDependencyBootstrap ??
		defaultPromptForDependencyBootstrap;
	const choice = await prompt(candidate);
	if (choice === null)
		return { mode: "off", prompted: true, source: "prompted" };
	const mode = choice;

	await persistDependencyBootstrapPolicy(
		context.repoRoot,
		config,
		mode,
		options.dependencies,
		options.stderr,
	);

	return { mode, prompted: true, source: "prompted" };
}

async function persistDependencyBootstrapPolicy(
	repoRoot: string,
	config: EffectiveGjiConfig,
	mode: DependencyBootstrapMode,
	dependencies: DependencyBootstrapPromptDependencies | undefined,
	stderr: (chunk: string) => void,
): Promise<void> {
	const writeLocal =
		dependencies?.writeConfigKey ??
		(async (root, key, value) => {
			await updateLocalConfigKey(root, key, value);
		});
	const writeGlobal =
		dependencies?.writeGlobalRepoConfigKey ??
		(async (root, key, value) => {
			await updateGlobalRepoConfigKey(root, key, value);
		});

	try {
		if (config.installSaveTarget === "global") {
			await writeGlobal(repoRoot, "dependencyBootstrap", mode);
		} else {
			await writeLocal(repoRoot, "dependencyBootstrap", mode);
		}
	} catch (error) {
		stderr(
			`gji: failed to save dependencyBootstrap: ${toErrorMessage(error)}\n`,
		);
	}
}

async function defaultPromptForDependencyBootstrap(
	candidate: DependencyBootstrapCandidate,
): Promise<DependencyBootstrapMode | null> {
	const reuseHint = formatReuseHint(candidate);
	const subject =
		candidate.kind === "build-cache"
			? "dependencies and build state"
			: "dependencies";
	const choice = await select({
		message: `Set up ${candidate.adapter} ${subject} for new worktrees? (${candidate.lockfile})`,
		options: [
			{
				value: "cow-then-repair",
				label: "Reuse and repair (recommended)",
				hint: reuseHint,
			},
			{
				value: "install-only",
				label: "Install fresh each time",
				hint: candidate.repairCommand,
			},
			{
				value: "off",
				label: "Skip dependency setup",
				hint: "leave dependencies to project hooks or manual setup",
			},
		],
	});

	if (isCancel(choice)) return null;
	return choice as DependencyBootstrapMode;
}

function formatReuseHint(candidate: DependencyBootstrapCandidate): string {
	if (candidate.adapter === "pnpm") {
		return "reuse local node_modules through CoW, then run pnpm install --frozen-lockfile";
	}
	if (candidate.adapter === "npm") {
		return "npm uses a clean install because node_modules is not seeded";
	}
	if (!candidate.seedable) {
		return `repair ${candidate.target} with ${candidate.repairCommand}`;
	}
	return `reuse ${candidate.target} through CoW, then run ${candidate.repairCommand}`;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
