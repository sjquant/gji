import type {
	BootstrapEvent,
	DependencyBootstrapReporter,
} from "./dependency-bootstrap.js";
import { formatBytes } from "./format-bytes.js";
import type { SyncDirectoryReporter } from "./sync-directories.js";

export function createBootstrapReporter(
	write: (chunk: string) => void,
	json: boolean,
	measureCloneSize = false,
): SyncDirectoryReporter & DependencyBootstrapReporter {
	return {
		emitCachedFailureWarnings: !json,
		measureCloneSize: measureCloneSize && !json,
		write,
		cloned: (directory) => {
			if (json) return;
			write(
				`⚡ cloned ${directory.dir} (${formatBytes(directory.bytes)} → ${formatDuration(directory.ms)})\n`,
			);
		},
		skipped: (directory) => {
			if (json) return;
			write(`gji: skipped ${directory.dir} — ${directory.reason}\n`);
		},
		dependency: (event: BootstrapEvent) => {
			if (json) return;
			const target = event.target ? ` ${event.target}` : "";
			write(`gji: ${event.state}${target} — ${event.message}\n`);
		},
	};
}

function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}
