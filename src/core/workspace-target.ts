import path from "node:path";
import type { RepositoryContext } from "./repo-context.js";

export type WorkspaceSourceType = "branch" | "pull_request";
export type WorkspaceStatus = "pending" | "created" | "failed";

export interface WorkspaceTarget {
  sourceType: WorkspaceSourceType;
  branchIdentifier: string;
  sourceReference: string;
  destinationPath: string;
  status: WorkspaceStatus;
  createdAt?: Date;
}

export interface BuildWorkspaceTargetInput {
  context: RepositoryContext;
  sourceType: WorkspaceSourceType;
  branchIdentifier: string;
  sourceReference?: string;
}

export function sanitizeBranchIdentifier(branchIdentifier: string): string {
  const normalized = branchIdentifier.trim().replace(/^refs\/heads\//, "");

  if (!normalized) {
    throw new Error("Branch identifier is required.");
  }

  const sanitized = normalized
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!sanitized) {
    throw new Error("Branch identifier must contain at least one path-safe character.");
  }

  return sanitized;
}

export function buildWorkspaceTarget(input: BuildWorkspaceTargetInput): WorkspaceTarget {
  const safeBranch = sanitizeBranchIdentifier(input.branchIdentifier);
  const sourceReference = input.sourceReference ?? input.branchIdentifier;

  return {
    sourceType: input.sourceType,
    branchIdentifier: safeBranch,
    sourceReference,
    destinationPath: path.join(input.context.workspaceRootPath, safeBranch),
    status: "pending",
  };
}
