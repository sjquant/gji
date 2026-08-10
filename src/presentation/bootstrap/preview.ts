import type { DependencyBootstrapPreview } from "../../ports/bootstrap.js";

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
