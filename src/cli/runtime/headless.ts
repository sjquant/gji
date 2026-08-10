/**
 * Returns true when running in a non-interactive (headless) environment.
 * Set GJI_NO_TUI=1 to disable all interactive prompts.
 * Commands that would otherwise hang waiting for input must fail fast instead.
 */
export function isHeadless(): boolean {
	return process.env.GJI_NO_TUI === "1";
}
