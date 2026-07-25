import {
	loadGlobalConfig,
	parseConfigValue,
	unsetGlobalConfigKey,
	updateGlobalConfigKey,
} from "./config.js";

export interface ConfigCommandOptions {
	action?: string;
	cwd: string;
	key?: string;
	stderr?: (chunk: string) => void;
	stdout: (chunk: string) => void;
	value?: string;
}

export async function runConfigCommand(
	options: ConfigCommandOptions,
): Promise<number> {
	switch (options.action) {
		case undefined: {
			const loaded = await loadGlobalConfig();
			writeJson(options.stdout, loaded.config);
			return 0;
		}
		case "get": {
			const loaded = await loadGlobalConfig();

			writeJson(
				options.stdout,
				options.key ? loaded.config[options.key] : loaded.config,
			);
			return 0;
		}
		case "set":
			if (options.key && options.value !== undefined) {
				try {
					await updateGlobalConfigKey(
						options.key,
						parseConfigValue(options.value),
					);
				} catch (error) {
					options.stderr?.(
						`gji config: ${error instanceof Error ? error.message : String(error)}\n`,
					);
					return 1;
				}
				return 0;
			}
			break;
		case "unset":
			if (options.key) {
				await unsetGlobalConfigKey(options.key);
				return 0;
			}
			break;
	}

	throw new Error(
		`Invalid config arguments: ${[options.action, options.key, options.value].filter(Boolean).join(" ")}`,
	);
}

function writeJson(stdout: (chunk: string) => void, value: unknown): void {
	stdout(`${JSON.stringify(value, null, 2)}\n`);
}
