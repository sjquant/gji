import type { SyncDirectoryReporter } from "./sync-directories.js";

export function createBootstrapReporter(
	write: (chunk: string) => void,
	json: boolean,
	measureCloneSize = false,
): SyncDirectoryReporter {
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
		dependency: (event) => {
			if (json) return;
			const target = event.target ? ` ${event.target}` : "";
			write(`gji: ${event.state}${target} — ${event.message}\n`);
		},
	};
}

function formatBytes(bytes: number | undefined): string {
	if (bytes === undefined) return "size unavailable";
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = -1;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}
