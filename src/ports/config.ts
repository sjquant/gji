export interface ConfigPort {
	loadEffectiveConfig(
		root: string,
		home?: string,
		onWarning?: (message: string) => void,
	): Promise<Record<string, unknown>>;
	resolveConfigString(
		config: Record<string, unknown>,
		key: string,
	): string | undefined;
}
