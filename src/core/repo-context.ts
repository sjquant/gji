import path from "node:path";
import { defaultGitClient, type GitClient } from "./git-client.js";

export interface RepositoryContext {
  repoName: string;
  repoRootPath: string;
  commonGitDirPath: string;
  workspaceRootPath: string;
  defaultIntegrationBranch: string;
}

export interface ResolveRepositoryContextOptions {
  cwd?: string;
  gitClient?: GitClient;
}

export function normalizeGitCommonDir(commonGitDir: string, cwd: string): string {
  if (path.isAbsolute(commonGitDir)) {
    return path.normalize(commonGitDir);
  }
  return path.resolve(cwd, commonGitDir);
}

export function inferRepoRootFromCommonGitDir(commonGitDirPath: string): string {
  if (path.basename(commonGitDirPath) === ".git") {
    return path.dirname(commonGitDirPath);
  }
  return path.dirname(commonGitDirPath);
}

export function deriveWorkspaceRootPath(repoRootPath: string): string {
  const repoName = path.basename(repoRootPath);
  return path.resolve(repoRootPath, "..", ".worktrees", repoName);
}

function parseDefaultBranchFromSymbolicRef(stdout: string): string {
  const normalized = stdout.trim();
  const segments = normalized.split("/");
  return segments[segments.length - 1] || "main";
}

async function resolveDefaultIntegrationBranch(gitClient: GitClient, cwd: string): Promise<string> {
  const result = await gitClient.run(["symbolic-ref", "refs/remotes/origin/HEAD"], {
    cwd,
  });

  if (result.code !== 0 || !result.stdout.trim()) {
    return "main";
  }

  return parseDefaultBranchFromSymbolicRef(result.stdout);
}

export async function resolveRepositoryContext(
  options: ResolveRepositoryContextOptions = {},
): Promise<RepositoryContext> {
  const cwd = options.cwd ?? process.cwd();
  const gitClient = options.gitClient ?? defaultGitClient;

  const [{ stdout: topLevelRaw }, { stdout: commonDirRaw }] = await Promise.all([
    gitClient.runOrThrow(["rev-parse", "--show-toplevel"], { cwd }),
    gitClient.runOrThrow(["rev-parse", "--git-common-dir"], { cwd }),
  ]);

  const topLevelPath = topLevelRaw.trim();
  const commonGitDirPath = normalizeGitCommonDir(commonDirRaw.trim(), topLevelPath || cwd);
  const repoRootPath = inferRepoRootFromCommonGitDir(commonGitDirPath);
  const repoName = path.basename(repoRootPath || topLevelPath);
  const workspaceRootPath = deriveWorkspaceRootPath(repoRootPath || topLevelPath);
  const defaultIntegrationBranch = await resolveDefaultIntegrationBranch(gitClient, cwd);

  if (!repoRootPath) {
    throw new Error("Unable to determine repository root.");
  }

  return {
    repoName,
    repoRootPath,
    commonGitDirPath,
    workspaceRootPath,
    defaultIntegrationBranch,
  };
}
