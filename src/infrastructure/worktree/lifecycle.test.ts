import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
	addLinkedWorktree,
	addSubmoduleToRepository,
	createRepository,
	createRepositoryWithOrigin,
	currentBranch,
	pathExists,
	runGit,
} from "../../test-support/repository.js";
import { retryGitContention } from "../git/runner.js";
import {
	addWorktree,
	createBranch,
	deleteBranch,
	forceDeleteBranch,
	forceRemoveWorktree,
	removeWorktree,
} from "./lifecycle.js";

describe("worktree management", () => {
	it("force-removes a worktree with initialized submodules", async () => {
		// Given a linked worktree with an initialized submodule.
		const repoRoot = await createRepository();
		await addSubmoduleToRepository(repoRoot);
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

	it("creates a tracking branch once another process releases the config lock", async () => {
		// Given another process briefly holds the Git config lock.
		const { repoRoot } = await createRepositoryWithOrigin();
		const lockPath = join(repoRoot, ".git", "config.lock");
		const startPoint = `origin/${await currentBranch(repoRoot)}`;
		await writeFile(lockPath, "");
		const released = new Promise((resolve) => setTimeout(resolve, 300)).then(
			() => rm(lockPath),
		);

		// When creating the tracking branch during that time.
		await createBranch(repoRoot, "feature/waited", { startPoint });
		await released;

		// Then the upstream is written.
		expect(
			await runGit(repoRoot, ["config", "branch.feature/waited.remote"]),
		).toBe("origin");
	});

	it("leaves no branch behind when the config lock is never released", async () => {
		// Given another process holds the Git config lock indefinitely, and a clock
		// that jumps past every retry deadline.
		const { repoRoot } = await createRepositoryWithOrigin();
		const lockPath = join(repoRoot, ".git", "config.lock");
		const startPoint = `origin/${await currentBranch(repoRoot)}`;
		await writeFile(lockPath, "");
		let now = Date.now();
		const clock = vi.spyOn(Date, "now").mockImplementation(() => {
			now += 60_000;
			return now;
		});

		try {
			// When creating a tracking branch outlasts its retry window.
			await expect(
				createBranch(repoRoot, "feature/locked", { startPoint }),
			).rejects.toThrow("could not lock config file");
		} finally {
			clock.mockRestore();
			await rm(lockPath);
		}

		// Then neither the branch nor any tracking config remains.
		expect(await runGit(repoRoot, ["branch", "--list", "feature/locked"])).toBe(
			"",
		);
		expect(await runGit(repoRoot, ["config", "--list"])).not.toContain(
			"branch.feature/locked",
		);
	});

	it("fails at once on a branch name that conflicts with an existing branch", async () => {
		// Given a branch whose name blocks the requested one, which no retry can clear.
		const repoRoot = await createRepository();
		await runGit(repoRoot, ["branch", "feature"]);
		const startedAt = Date.now();

		// When creating the conflicting branch.
		await expect(createBranch(repoRoot, "feature/conflict")).rejects.toThrow(
			"exists; cannot create",
		);

		// Then the error arrives well inside the lock retry window.
		expect(Date.now() - startedAt).toBeLessThan(3_000);
	});

	it("adds a worktree once another process finishes creating its own", async () => {
		// Given another process is partway through git worktree add.
		const repoRoot = await createRepository();
		await runGit(repoRoot, ["branch", "feature/wait"]);
		const worktreePath = `${repoRoot}-wait`;
		const { finished } = await holdHalfCreatedWorktree(repoRoot);

		// When adding a worktree during that time.
		await addWorktree(repoRoot, worktreePath, { branch: "feature/wait" });
		await finished;

		// Then the worktree is created once the other process is done.
		expect(await currentBranch(worktreePath)).toBe("feature/wait");
	});

	it.each([
		{ name: "git worktree remove", remove: removeWorktree },
		{ name: "git worktree remove --force", remove: forceRemoveWorktree },
	])("retries $name while another process creates its worktree", async ({
		remove,
	}) => {
		// Given a linked worktree, and another process partway through git worktree add.
		const repoRoot = await createRepository();
		const worktreePath = await addLinkedWorktree(repoRoot, "feature/remove");
		const { finished } = await holdHalfCreatedWorktree(repoRoot);

		// When removing the worktree during that time.
		await remove(repoRoot, worktreePath);
		await finished;

		// Then it is gone.
		expect(await pathExists(worktreePath)).toBe(false);
	});

	it.each([
		{ name: "git branch -d", remove: deleteBranch },
		{ name: "git branch -D", remove: forceDeleteBranch },
	])("retries $name while another process creates its worktree", async ({
		remove,
	}) => {
		// Given a merged branch, and another process partway through git worktree add.
		const repoRoot = await createRepository();
		await runGit(repoRoot, ["branch", "feature/delete"]);
		const { finished } = await holdHalfCreatedWorktree(repoRoot);

		// When deleting the branch during that time.
		await remove(repoRoot, "feature/delete");
		await finished;

		// Then it is gone.
		expect(await runGit(repoRoot, ["branch", "--list", "feature/delete"])).toBe(
			"",
		);
	});

	it("retries when Git finds a worktree entry already being removed", async () => {
		// Given Git reports an entry that another process has just removed.
		const operation = vi
			.fn()
			.mockRejectedValueOnce(
				new Error(
					"fatal: Invalid path '/repo/.git/worktrees/4': No such file or directory",
				),
			)
			.mockResolvedValueOnce("done");

		// When the operation runs through the retry.
		const result = await retryGitContention(operation);

		// Then the second attempt succeeds.
		expect(result).toBe("done");
	});
});

// Reproduces the moment when git worktree add has created the commondir file but
// not written it yet. Removing the entry stands in for the other process finishing.
async function holdHalfCreatedWorktree(
	repoRoot: string,
): Promise<{ finished: Promise<void> }> {
	const entry = join(repoRoot, ".git", "worktrees", "half-created");
	await mkdir(entry, { recursive: true });
	await writeFile(join(entry, "commondir"), "");
	await writeFile(join(entry, "gitdir"), `${entry}/missing/.git\n`);
	await writeFile(join(entry, "HEAD"), "ref: refs/heads/half-created\n");
	return {
		finished: new Promise((resolve) => setTimeout(resolve, 500)).then(() =>
			rm(entry, { recursive: true }),
		),
	};
}
