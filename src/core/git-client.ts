import { spawn } from "node:child_process";

export interface GitRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface GitCommandResult {
  args: string[];
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitClient {
  run(args: string[], options?: GitRunOptions): Promise<GitCommandResult>;
  runOrThrow(args: string[], options?: GitRunOptions): Promise<GitCommandResult>;
}

export class DefaultGitClient implements GitClient {
  async run(args: string[], options: GitRunOptions = {}): Promise<GitCommandResult> {
    return new Promise<GitCommandResult>((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        resolve({
          args,
          code: code ?? 1,
          stdout,
          stderr,
        });
      });
    });
  }

  async runOrThrow(args: string[], options: GitRunOptions = {}): Promise<GitCommandResult> {
    const result = await this.run(args, options);
    if (result.code !== 0) {
      const rendered = result.stderr.trim() || `git ${args.join(" ")} failed`;
      throw new Error(rendered);
    }
    return result;
  }
}

export const defaultGitClient: GitClient = new DefaultGitClient();
