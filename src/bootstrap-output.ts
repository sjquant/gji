import type {
	BootstrapEvent,
	DependencyBootstrapReporter,
} from "./dependency-bootstrap.js";

export function createBootstrapReporter(
	write: (chunk: string) => void,
	json: boolean,
): DependencyBootstrapReporter & { write: (chunk: string) => void } {
	return {
		write,
		dependency: (event: BootstrapEvent) => {
			if (json) return;
			const target = event.target ? ` ${event.target}` : "";
			write(`gji: ${event.state}${target} — ${event.message}\n`);
		},
	};
}
