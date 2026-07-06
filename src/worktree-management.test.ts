import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
	addLinkedWorktree,
	createRepository,
	pathExists,
	runGit,
} from "./repo.test-helpers.js";
import {
	forceRemoveWorktree,
	isWorktreeForceRemovalError,
} from "./worktree-management.js";

describe("worktree management", () => {
	it("classifies git directory deletion failures as force-removal errors", () => {
		// Given Git failed after trying to delete a worktree directory.
		const error = Object.assign(new Error("Command failed"), {
			stderr:
				"error: failed to delete '/tmp/repo-worktree': Directory not empty\n",
		});

		// When the error is checked for force-removal handling.
		const result = isWorktreeForceRemovalError(error);

		// Then callers can recover through the force-removal path.
		expect(result).toBe(true);
	});

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
