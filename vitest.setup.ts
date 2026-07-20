import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach } from "vitest";

const SHELL_OUTPUT_ENV_VARS = [
	"GJI_BACK_OUTPUT_FILE",
	"GJI_DONE_OUTPUT_FILE",
	"GJI_GO_OUTPUT_FILE",
	"GJI_NEW_OUTPUT_FILE",
	"GJI_PR_OUTPUT_FILE",
	"GJI_REMOVE_OUTPUT_FILE",
	"GJI_ROOT_OUTPUT_FILE",
	"GJI_WARP_OUTPUT_FILE",
] as const;

beforeEach(() => {
	const home = mkdtempSync(join(tmpdir(), "gji-home-"));
	const configDir = join(home, ".config", "gji");

	mkdirSync(configDir, { recursive: true });
	process.env.HOME = home;
	process.env.GJI_CONFIG_DIR = configDir;
	for (const variable of SHELL_OUTPUT_ENV_VARS) {
		delete process.env[variable];
	}
});
