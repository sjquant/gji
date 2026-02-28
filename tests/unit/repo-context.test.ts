import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveWorkspaceRootPath,
  normalizeGitCommonDir,
  resolveRepositoryContext,
} from "../../src/core/repo-context.js";
import type { GitClient, GitCommandResult } from "../../src/core/git-client.js";

class StubGitClient implements GitClient {
  constructor(private readonly responses: Record<string, GitCommandResult>) {}

  async run(args: string[]): Promise<GitCommandResult> {
    const key = args.join(" ");
    return (
      this.responses[key] ?? {
        args,
        code: 1,
        stdout: "",
        stderr: "not mocked",
      }
    );
  }

  async runOrThrow(args: string[]): Promise<GitCommandResult> {
    const result = await this.run(args);
    if (result.code !== 0) {
      throw new Error(result.stderr || "failed");
    }
    return result;
  }
}

describe("repo-context", () => {
  it("normalizes relative git common dir path", () => {
    const cwd = "/tmp/project";
    expect(normalizeGitCommonDir(".git", cwd)).toBe(path.join(cwd, ".git"));
  });

  it("derives deterministic workspace root path", () => {
    expect(deriveWorkspaceRootPath("/work/repo")).toBe("/work/.worktrees/repo");
  });

  it("resolves shared repository context from nested worktree", async () => {
    const gitClient = new StubGitClient({
      "rev-parse --show-toplevel": {
        args: ["rev-parse", "--show-toplevel"],
        code: 0,
        stdout: "/work/.worktrees/repo/feature\n",
        stderr: "",
      },
      "rev-parse --git-common-dir": {
        args: ["rev-parse", "--git-common-dir"],
        code: 0,
        stdout: "/work/repo/.git\n",
        stderr: "",
      },
      "symbolic-ref refs/remotes/origin/HEAD": {
        args: ["symbolic-ref", "refs/remotes/origin/HEAD"],
        code: 0,
        stdout: "refs/remotes/origin/main\n",
        stderr: "",
      },
    });

    const context = await resolveRepositoryContext({
      cwd: "/work/.worktrees/repo/feature",
      gitClient,
    });

    expect(context.repoName).toBe("repo");
    expect(context.repoRootPath).toBe("/work/repo");
    expect(context.workspaceRootPath).toBe("/work/.worktrees/repo");
    expect(context.defaultIntegrationBranch).toBe("main");
  });
});
