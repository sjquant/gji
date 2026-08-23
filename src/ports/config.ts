export type GjiConfig = Record<string, unknown>;

export type DependencyBootstrapSetting = "off";

export const KNOWN_CONFIG_KEYS: ReadonlySet<string> = new Set([
	"branchPrefix",
	"dependencyBuildCommand",
	"dependencyBootstrap",
	"editor",
	"hooks",
	"installSaveTarget",
	"shellIntegration",
	"syncDefaultBranch",
	"syncFiles",
	"syncRemote",
	"worktreePath",
]);

export const KNOWN_GLOBAL_CONFIG_KEYS: ReadonlySet<string> = new Set([
	...KNOWN_CONFIG_KEYS,
	"repos",
]);

export interface EffectiveGjiConfig extends GjiConfig {
	branchPrefix?: string;
	dependencyBuildCommand?: string;
	dependencyBootstrap?: DependencyBootstrapSetting;
	editor?: string;
	hooks?: Record<string, unknown>;
	installSaveTarget?: string;
	shellIntegration?: string;
	syncFiles?: readonly string[];
	syncDefaultBranch?: string;
	syncRemote?: string;
	worktreePath?: string;
}

export interface ConfigPort {
	loadEffectiveConfig(
		root: string,
		home?: string,
		onWarning?: (message: string) => void,
	): Promise<EffectiveGjiConfig>;
	resolveConfigString(config: GjiConfig, key: string): string | undefined;
}
