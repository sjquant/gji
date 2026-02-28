import { describe, expect, it } from "vitest";
import {
  buildWorkspaceTarget,
  sanitizeBranchIdentifier,
} from "../../src/core/workspace-target.js";
import type { RepositoryContext } from "../../src/core/repo-context.js";

const context: RepositoryContext = {
  repoName: "repo",
  repoRootPath: "/work/repo",
  commonGitDirPath: "/work/repo/.git",
  workspaceRootPath: "/work/.worktrees/repo",
  defaultIntegrationBranch: "main",
};

describe("workspace-target", () => {
  it("sanitizes branch names for filesystem safety", () => {
    expect(sanitizeBranchIdentifier("feature/add api")).toBe("feature-add-api");
  });

  it("rejects empty branch identifiers", () => {
    expect(() => sanitizeBranchIdentifier("   ")).toThrow("Branch identifier is required");
  });

  it("builds deterministic destination path", () => {
    const target = buildWorkspaceTarget({
      context,
      sourceType: "branch",
      branchIdentifier: "feature/add-api",
    });

    expect(target.branchIdentifier).toBe("feature-add-api");
    expect(target.sourceReference).toBe("feature/add-api");
    expect(target.destinationPath).toBe("/work/.worktrees/repo/feature-add-api");
    expect(target.status).toBe("pending");
  });
});
