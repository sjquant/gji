import type { DependencyBootstrapMode } from "./config.js";
import {
	type BootstrapStrategy,
	type BootstrapTarget,
	type DependencyBootstrapPreview,
	prepareDependencyBootstrap,
	previewDependencyBootstrap,
} from "./dependency-bootstrap.js";

export async function createDependencyBootstrapPreview(
	mode: DependencyBootstrapMode,
	context: {
		repoRoot: string;
		currentRoot?: string;
		worktreePath: string;
		cargoBuildCommand?: string;
		checkUvRuntime?: (target: BootstrapTarget) => Promise<boolean>;
	},
): Promise<DependencyBootstrapPreview> {
	return previewDependencyBootstrap(
		await prepareDependencyBootstrap(mode, context),
	);
}

export function formatDependencyBootstrapPreview(
	preview: DependencyBootstrapPreview | undefined,
): string {
	if (!preview) return "";
	return preview.targets
		.map(
			({ adapter, target, strategy }) =>
				`Would ${formatBootstrapStrategy(strategy)} ${target} with ${adapter}\n`,
		)
		.join("");
}

function formatBootstrapStrategy(strategy: BootstrapStrategy): string {
	switch (strategy) {
		case "cow-then-repair":
			return "seed and repair";
		case "repair-only":
			return "repair";
		case "install-only":
			return "install";
	}
}
