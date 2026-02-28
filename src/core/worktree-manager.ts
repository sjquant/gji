import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { defaultGitClient, type GitClient } from "./git-client.js";
import type { WorkspaceTarget } from "./workspace-target.js";

export interface WorktreeSummary {
  path: string;
  branch: string;
  commit: string;
}

export class WorktreeManager {
  constructor(private readonly gitClient: GitClient = defaultGitClient) {}

  async ensureWorkspaceRoot(workspaceRootPath: string): Promise<void> {
    await mkdir(workspaceRootPath, { recursive: true });
  }

  async createWorktree(repoRootPath: string, target: WorkspaceTarget): Promise<WorkspaceTarget> {
    await this.ensureWorkspaceRoot(path.dirname(target.destinationPath));

    await this.gitClient.runOrThrow(
      ["worktree", "add", target.destinationPath, target.sourceReference],
      {
        cwd: repoRootPath,
      },
    );

    return {
      ...target,
      status: "created",
      createdAt: new Date(),
    };
  }

  async listWorktrees(cwd: string): Promise<WorktreeSummary[]> {
    const result = await this.gitClient.runOrThrow(["worktree", "list", "--porcelain"], {
      cwd,
    });

    const summaries: WorktreeSummary[] = [];
    const blocks = result.stdout.split("\n\n").map((block) => block.trim()).filter(Boolean);

    for (const block of blocks) {
      const lines = block.split("\n");
      const pathLine = lines.find((line) => line.startsWith("worktree "));
      const branchLine = lines.find((line) => line.startsWith("branch "));
      const commitLine = lines.find((line) => /^[a-f0-9]{40}$/i.test(line));

      if (!pathLine || !commitLine) {
        continue;
      }

      summaries.push({
        path: pathLine.replace("worktree ", "").trim(),
        branch: branchLine?.replace("branch refs/heads/", "").trim() ?? "(detached)",
        commit: commitLine.trim(),
      });
    }

    return summaries;
  }

  async removeWorktree(repoRootPath: string, workspacePath: string, force = false): Promise<void> {
    const args = ["worktree", "remove"];
    if (force) {
      args.push("--force");
    }
    args.push(workspacePath);

    const result = await this.gitClient.run(args, { cwd: repoRootPath });
    if (result.code === 0) {
      return;
    }

    await rm(workspacePath, { recursive: true, force: true });
  }
}
