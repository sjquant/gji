export interface RemoteBase {
	branch: string;
	ref: string;
}

export interface GitCommandPort {
	runGit(cwd: string, args: string[]): Promise<string>;
	runGitRaw(cwd: string, args: string[]): Promise<string>;
}
