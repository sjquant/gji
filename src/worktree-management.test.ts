import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
	addLinkedWorktree,
	createRepository,
	pathExists,
	runGit,
} from "./repo.test-helpers.js";
import { forceRemoveWorktree } from "./worktree-management.js";

describe("worktree management", () => {
	it("removes residual directories for worktrees git has already unregistered", async () => {
		// Given Git has removed the worktree registration but left files on disk.
		const repoRoot = await createRepository();
		const branch = "feature/residual-worktree-directory";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		await runGit(repoRoot, ["worktree", "remove", "--force", worktreePath]);
		await mkdir(worktreePath, { recursive: true });
		await writeFile(join(worktreePath, "leftover.txt"), "leftover", "utf8");

		// When force removal runs after the worktree has been unregistered.
		await forceRemoveWorktree(repoRoot, worktreePath);

		// Then the residual directory is removed.
		await expect(pathExists(worktreePath)).resolves.toBe(false);
	});
});
