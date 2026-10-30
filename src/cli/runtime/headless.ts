/**
 * Returns true when no one can answer a prompt: GJI_NO_TUI=1 is set, or stdin
 * or stdout is not a terminal.
 * Commands that would otherwise wait for input must fail fast instead.
 */
export function isHeadless(): boolean {
	return (
		process.env.GJI_NO_TUI === "1" ||
		process.stdin.isTTY !== true ||
		process.stdout.isTTY !== true
	);
}
