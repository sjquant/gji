import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface GitFixture {
  rootPath: string;
  runGit(args: string[], cwd?: string): string;
  cleanup(): Promise<void>;
}

function runGitRaw(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export async function createGitFixture(branchName = "main"): Promise<GitFixture> {
  const rootPath = await mkdtemp(path.join(tmpdir(), "gji-fixture-"));

  runGitRaw(["init", "-b", branchName], rootPath);
  runGitRaw(["config", "user.name", "gji-test"], rootPath);
  runGitRaw(["config", "user.email", "gji-test@example.com"], rootPath);

  await writeFile(path.join(rootPath, "README.md"), "fixture\n", "utf8");
  runGitRaw(["add", "README.md"], rootPath);
  runGitRaw(["commit", "-m", "initial commit"], rootPath);

  return {
    rootPath,
    runGit(args: string[], cwd = rootPath): string {
      return runGitRaw(args, cwd);
    },
    async cleanup(): Promise<void> {
      await rm(rootPath, { recursive: true, force: true });
    },
  };
}
