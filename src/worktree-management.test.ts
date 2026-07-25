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
	it("force-removes a worktree with initialized submodules", async () => {
		// Given a linked worktree with an initialized submodule.
		const repoRoot = await createRepository();
		const submoduleRoot = await createRepository();
		await runGit(repoRoot, [
			"-c",
			"protocol.file.allow=always",
			"submodule",
			"add",
			submoduleRoot,
			"vendor/submodule",
		]);
		await runGit(repoRoot, ["commit", "-am", "add submodule"]);
		const branch = "feature/initialized-submodule";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		await runGit(worktreePath, [
			"-c",
			"protocol.file.allow=always",
			"submodule",
			"update",
			"--init",
		]);

		// When force removal runs for that worktree.
		await forceRemoveWorktree(repoRoot, worktreePath);

		// Then Git unregisters the worktree and removes its directory.
		await expect(pathExists(worktreePath)).resolves.toBe(false);
		await expect(runGit(repoRoot, ["worktree", "list"])).resolves.not.toContain(
			worktreePath,
		);
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
