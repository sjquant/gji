import { execFile } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { resolveWorktreePath } from "../../domain/worktree/policy.js";
import { createRepository } from "../../test-support/repository.js";
import { detectRepository } from "./context.js";

const execFileAsync = promisify(execFile);

describe("detectRepository", () => {
	it("finds the main repository root from the repository root", async () => {
		const repoRoot = await createRepository();

		const result = await detectRepository(repoRoot);

		expect(result).toMatchObject({
			currentRoot: repoRoot,
			isWorktree: false,
			repoName: "gji-test-repo",
			repoRoot,
		});
	});

	it("finds the main repository root from a nested linked worktree path", async () => {
		const repoRoot = await createRepository();
		const branchName = "feature/nested-path";
		const worktreePath = resolveWorktreePath(repoRoot, branchName);

		await runGit(repoRoot, ["branch", branchName]);
		await runGit(repoRoot, ["worktree", "add", worktreePath, branchName]);
		await mkdir(join(worktreePath, "deep", "inside"), { recursive: true });
		const realWorktreePath = await realpath(worktreePath);

		const result = await detectRepository(join(worktreePath, "deep", "inside"));

		expect(result).toMatchObject({
			currentRoot: realWorktreePath,
			isWorktree: true,
			repoName: "gji-test-repo",
			repoRoot,
		});
	});
});

async function runGit(cwd: string, args: string[]): Promise<void> {
	await execFileAsync("git", args, { cwd });
}
