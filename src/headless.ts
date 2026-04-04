/**
 * Returns true when running in a non-interactive (headless) environment.
 * Triggered by GJI_NO_TUI=1 or the presence of NO_COLOR (standard CI signal).
 * Commands that would otherwise hang waiting for input must fail fast instead.
 */
export function isHeadless(): boolean {
  return process.env.GJI_NO_TUI === '1' || 'NO_COLOR' in process.env;
}
