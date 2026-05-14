import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach } from "vitest";

beforeEach(() => {
	const home = mkdtempSync(join(tmpdir(), "gji-home-"));
	const configDir = join(home, ".config", "gji");

	mkdirSync(configDir, { recursive: true });
	process.env.HOME = home;
	process.env.GJI_CONFIG_DIR = configDir;
});
