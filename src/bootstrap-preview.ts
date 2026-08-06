import type { DependencyBootstrapMode } from "./dependency-bootstrap.js";
import {
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
			({ adapter, target, command }) =>
				`Would install ${target || "dependencies"} with ${adapter}: ${command}\n`,
		)
		.join("");
}
