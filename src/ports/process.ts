export type CommandRunner = (
	command: string,
	cwd: string,
	stderr: (chunk: string) => void,
	stdout?: (chunk: string) => void,
	options?: CommandRunnerOptions,
) => Promise<void>;

export interface CommandRunnerOptions {
	env?: NodeJS.ProcessEnv;
	shell?: boolean;
}
