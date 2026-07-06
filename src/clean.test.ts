import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { createCleanCommand } from "./clean.js";
import { HISTORY_FILE_PATH } from "./history.js";
import {
	addLinkedWorktree,
	commitFile,
	createRepository,
	createRepositoryWithOrigin,
	pathExists,
	runGit,
} from "./repo.test-helpers.js";

describe("gji clean", () => {
	it("removes selected branch-backed and detached worktrees and prints the repo root", async () => {
		// Given a repository root with branch-backed and detached linked worktrees.
		const repoRoot = await createRepository();
		const keepBranch = "feature/clean-keep";
		const removeBranch = "feature/clean-remove";
		const keepWorktreePath = await addLinkedWorktree(repoRoot, keepBranch);
		const removeWorktreePath = await addLinkedWorktree(repoRoot, removeBranch);
		const detachedWorktreePath = `${repoRoot}-detached`;
		const stdout: string[] = [];
		await runGit(repoRoot, [
			"worktree",
			"add",
			"--detach",
			detachedWorktreePath,
			"HEAD",
		]);
		const runCleanCommand = createCleanCommand({
			confirmRemoval: async (worktrees) => {
				expect(worktrees.map((worktree) => worktree.path).sort()).toEqual(
					[detachedWorktreePath, removeWorktreePath].sort(),
				);
				return true;
			},
			promptForWorktrees: async (worktrees) => {
				expect(worktrees.map((worktree) => worktree.branch).sort()).toEqual(
					[keepBranch, removeBranch, null].sort(),
				);
				return [removeWorktreePath, detachedWorktreePath];
			},
		});

		// When gji clean runs and those stale worktrees are selected.
		expect(
			await runCleanCommand({
				cwd: repoRoot,
				stderr: () => undefined,
				stdout: (chunk) => stdout.push(chunk),
			}),
		).toBe(0);

		// Then it removes only the selected worktrees and their branch when present.
		await expect(pathExists(keepWorktreePath)).resolves.toBe(true);
		await expect(branchExists(repoRoot, keepBranch)).resolves.toBe(true);
		await expect(pathExists(removeWorktreePath)).resolves.toBe(false);
		await expect(branchExists(repoRoot, removeBranch)).resolves.toBe(false);
		await expect(pathExists(detachedWorktreePath)).resolves.toBe(false);
		expect(stdout.join("")).toBe(`${repoRoot}\n`);
	});

	it("fails cleanly when there are no linked worktrees to prune", async () => {
		// Given a repository root without any linked worktrees.
		const repoRoot = await createRepository();
		const stderr: string[] = [];

		// When gji clean runs.
		expect(
			await createCleanCommand()({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			}),
		).toBe(1);

		// Then it reports that there is nothing to clean.
		expect(stderr.join("")).toBe("No linked worktrees to clean\n");
	});

	it("aborts cleanly when the interactive selection is cancelled", async () => {
		// Given a repository root with a linked worktree and a cancelled chooser.
		const repoRoot = await createRepository();
		const branch = "feature/clean-cancel";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		const stderr: string[] = [];
		const runCleanCommand = createCleanCommand({
			confirmRemoval: async () => {
				throw new Error(
					"confirmRemoval should not run after a cancelled prompt",
				);
			},
			promptForWorktrees: async () => null,
		});

		// When gji clean runs and the chooser is cancelled.
		expect(
			await runCleanCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			}),
		).toBe(1);

		// Then it leaves the worktree and branch intact and reports the abort.
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(branchExists(repoRoot, branch)).resolves.toBe(true);
		expect(stderr.join("")).toBe("Aborted\n");
	});

	it("aborts without removing anything when confirmation is declined", async () => {
		// Given a repository root with a selected linked worktree and a declined confirmation.
		const repoRoot = await createRepository();
		const branch = "feature/clean-decline";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		const stderr: string[] = [];
		const runCleanCommand = createCleanCommand({
			confirmRemoval: async (worktrees) => {
				expect(worktrees).toHaveLength(1);
				return false;
			},
			promptForWorktrees: async () => [worktreePath],
		});

		// When gji clean runs and the confirmation is declined.
		expect(
			await runCleanCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			}),
		).toBe(1);

		// Then it leaves the worktree and branch intact and reports the abort.
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(branchExists(repoRoot, branch)).resolves.toBe(true);
		expect(stderr.join("")).toBe("Aborted\n");
	});

	it("aborts cleanly when the multi-select submits no worktrees", async () => {
		// Given a repository root with a linked worktree and an empty selection.
		const repoRoot = await createRepository();
		const branch = "feature/clean-empty";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		const stderr: string[] = [];
		const runCleanCommand = createCleanCommand({
			confirmRemoval: async () => {
				throw new Error(
					"confirmRemoval should not run after an empty selection",
				);
			},
			promptForWorktrees: async () => [],
		});

		// When gji clean runs and no worktrees are selected.
		expect(
			await runCleanCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			}),
		).toBe(1);

		// Then it leaves the worktree and branch intact and reports the abort.
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(branchExists(repoRoot, branch)).resolves.toBe(true);
		expect(stderr.join("")).toBe("Aborted\n");
	});

	it("does not offer the current linked worktree as a clean candidate", async () => {
		// Given a repository with two linked worktrees and one of them is the current cwd.
		const repoRoot = await createRepository();
		const currentBranch = "feature/clean-current";
		const otherBranch = "feature/clean-other";
		const currentWorktreePath = await addLinkedWorktree(
			repoRoot,
			currentBranch,
		);
		const otherWorktreePath = await addLinkedWorktree(repoRoot, otherBranch);
		const runCleanCommand = createCleanCommand({
			confirmRemoval: async () => true,
			promptForWorktrees: async (worktrees) => {
				expect(worktrees.map((worktree) => worktree.path)).toEqual([
					otherWorktreePath,
				]);
				return [otherWorktreePath];
			},
		});

		// When gji clean runs from inside the current linked worktree.
		expect(
			await runCleanCommand({
				cwd: currentWorktreePath,
				stderr: () => undefined,
				stdout: () => undefined,
			}),
		).toBe(0);

		// Then it excludes the current worktree and only cleans the other one.
		await expect(pathExists(currentWorktreePath)).resolves.toBe(true);
		await expect(branchExists(repoRoot, currentBranch)).resolves.toBe(true);
		await expect(pathExists(otherWorktreePath)).resolves.toBe(false);
		await expect(branchExists(repoRoot, otherBranch)).resolves.toBe(false);
	});

	it("shows recency, path, and dirty state in the clean picker", async () => {
		// Given a dirty linked worktree with last-used history metadata.
		const originalConfigDir = process.env.GJI_CONFIG_DIR;
		process.env.GJI_CONFIG_DIR = await mkdtemp(join(tmpdir(), "gji-config-"));
		const repoRoot = await createRepository();
		const branch = "feature/clean-safety-labels";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		const repoName = repoRoot.split("/").at(-1)!;
		await writeFile(join(worktreePath, "dirty.txt"), "dirty", "utf8");
		await writeFile(
			HISTORY_FILE_PATH(),
			`${JSON.stringify(
				[
					{
						branch,
						path: worktreePath,
						timestamp: Date.now() - 2 * 60 * 60 * 1000,
					},
				],
				null,
				2,
			)}\n`,
			"utf8",
		);
		let capturedEntry: { label: string; path: string } | undefined;
		const runCleanCommand = createCleanCommand({
			confirmRemoval: async () => {
				throw new Error("confirmRemoval should not run after cancellation");
			},
			promptForWorktrees: async (worktrees) => {
				const entry = worktrees.find((worktree) => worktree.branch === branch);
				capturedEntry = entry
					? { label: entry.label, path: entry.path }
					: undefined;
				return null;
			},
		});

		try {
			// When gji clean shows its picker.
			const result = await runCleanCommand({
				cwd: repoRoot,
				stderr: () => undefined,
				stdout: () => undefined,
			});

			// Then the picker entry exposes safety-critical context before confirmation.
			expect(result).toBe(1);
			expect(capturedEntry?.label).toContain(repoName);
			expect(capturedEntry?.label).toContain(branch);
			expect(capturedEntry?.label).toContain("[dirty]");
			expect(capturedEntry?.label).toContain("last used: 2h ago");
			expect(capturedEntry?.label).toContain("clean-safety-labels");
			expect(capturedEntry?.path).toBe(worktreePath);
			await expect(pathExists(worktreePath)).resolves.toBe(true);
		} finally {
			if (originalConfigDir === undefined) {
				delete process.env.GJI_CONFIG_DIR;
			} else {
				process.env.GJI_CONFIG_DIR = originalConfigDir;
			}
		}
	});

	it("removes only safe stale worktrees when --stale --force is used", async () => {
		// Given a repository with stale, active, and unmerged stale linked worktrees.
		const { repoRoot } = await createRepositoryWithOrigin();
		const staleBranch = "feature/clean-stale-safe";
		const activeBranch = "feature/clean-stale-active";
		const unmergedBranch = "feature/clean-stale-unmerged";
		const staleWorktreePath = await addRemoteTrackedWorktree(
			repoRoot,
			staleBranch,
		);
		const activeWorktreePath = await addRemoteTrackedWorktree(
			repoRoot,
			activeBranch,
		);
		const unmergedWorktreePath = await addRemoteTrackedWorktree(
			repoRoot,
			unmergedBranch,
		);
		await commitFile(
			unmergedWorktreePath,
			"unmerged.txt",
			"content",
			"Unmerged stale work",
		);
		await deleteRemoteBranch(repoRoot, staleBranch);
		await deleteRemoteBranch(repoRoot, unmergedBranch);
		await runGit(repoRoot, [
			"merge",
			"--no-ff",
			unmergedBranch,
			"-m",
			"Merge unmerged stale work locally",
		]);
		const stdout: string[] = [];
		const runCleanCommand = createCleanCommand({
			confirmRemoval: async () => {
				throw new Error("confirmRemoval should not be called with --force");
			},
			promptForWorktrees: async () => {
				throw new Error("promptForWorktrees should not be called with --force");
			},
		});

		// When gji clean --stale --force --json runs.
		expect(
			await runCleanCommand({
				cwd: repoRoot,
				force: true,
				json: true,
				stale: true,
				stderr: () => undefined,
				stdout: (chunk) => stdout.push(chunk),
			}),
		).toBe(0);

		// Then it prunes only the worktree merged into the remote default branch and reports stale upstream.
		await expect(pathExists(staleWorktreePath)).resolves.toBe(false);
		await expect(branchExists(repoRoot, staleBranch)).resolves.toBe(false);
		await expect(pathExists(activeWorktreePath)).resolves.toBe(true);
		await expect(branchExists(repoRoot, activeBranch)).resolves.toBe(true);
		await expect(pathExists(unmergedWorktreePath)).resolves.toBe(true);
		await expect(branchExists(repoRoot, unmergedBranch)).resolves.toBe(true);
		const output = JSON.parse(stdout.join(""));
		expect(output.removed).toEqual([
			expect.objectContaining({
				branch: staleBranch,
				lastCommitTimestamp: expect.any(Number),
				path: staleWorktreePath,
				status: "clean",
				upstream: { kind: "stale" },
			}),
		]);
	});

	it("skips a stale candidate that becomes dirty before removal", async () => {
		// Given a safe stale linked worktree that becomes dirty after selection.
		const { repoRoot } = await createRepositoryWithOrigin();
		const branch = "feature/clean-stale-race";
		const worktreePath = await addRemoteTrackedWorktree(repoRoot, branch);
		const stderr: string[] = [];
		await deleteRemoteBranch(repoRoot, branch);
		const runCleanCommand = createCleanCommand({
			confirmRemoval: async () => true,
			promptForWorktrees: async () => {
				await writeFile(join(worktreePath, "late-change.txt"), "dirty");
				return [worktreePath];
			},
		});

		// When gji clean --stale runs and the selected worktree is no longer safe.
		expect(
			await runCleanCommand({
				cwd: repoRoot,
				stale: true,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			}),
		).toBe(0);

		// Then it skips the candidate instead of force-removing the dirty worktree.
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(branchExists(repoRoot, branch)).resolves.toBe(true);
		expect(stderr.join("")).toContain(
			"no longer a safe stale cleanup candidate",
		);
	});

	it("reports an empty no-op when --stale --json finds no stale worktrees", async () => {
		// Given a repository with an active linked worktree and no stale candidates.
		const { repoRoot } = await createRepositoryWithOrigin();
		const branch = "feature/clean-stale-none";
		const worktreePath = await addRemoteTrackedWorktree(repoRoot, branch);
		const stdout: string[] = [];
		const stderr: string[] = [];

		// When gji clean --stale --json --force runs.
		const result = await createCleanCommand()({
			cwd: repoRoot,
			force: true,
			json: true,
			stale: true,
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it succeeds without removing anything.
		expect(result).toBe(0);
		expect(stderr).toEqual([]);
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		await expect(branchExists(repoRoot, branch)).resolves.toBe(true);
		expect(JSON.parse(stdout.join(""))).toEqual({ removed: [] });
	});

	it("force-removes a dirty worktree when the user confirms", async () => {
		// Given a repository with a linked worktree that has an untracked file.
		const repoRoot = await createRepository();
		const branch = "feature/clean-dirty-confirm";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		await writeFile(join(worktreePath, "untracked.txt"), "dirty");
		let promptedForForce = false;
		const runCleanCommand = createCleanCommand({
			confirmForceRemoveWorktree: async () => {
				promptedForForce = true;
				return true;
			},
			confirmRemoval: async () => true,
			promptForWorktrees: async () => [worktreePath],
		});

		// When gji clean runs.
		expect(
			await runCleanCommand({
				cwd: repoRoot,
				stderr: () => undefined,
				stdout: () => undefined,
			}),
		).toBe(0);

		// Then it force-removes the worktree after prompting.
		await expect(pathExists(worktreePath)).resolves.toBe(false);
		expect(promptedForForce).toBe(true);
	});

	it("reports a dirty worktree failure when force remove is declined", async () => {
		// Given a repository with a linked worktree that has an untracked file and a declined force prompt.
		const repoRoot = await createRepository();
		const branch = "feature/clean-dirty-decline";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		await writeFile(join(worktreePath, "untracked.txt"), "dirty");
		const stderr: string[] = [];
		const runCleanCommand = createCleanCommand({
			confirmForceRemoveWorktree: async () => false,
			confirmRemoval: async () => true,
			promptForWorktrees: async () => [worktreePath],
		});

		// When gji clean runs and force remove is declined.
		expect(
			await runCleanCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			}),
		).toBe(1);

		// Then it leaves the worktree intact and reports the failed cleanup.
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		expect(stderr.join("")).toContain("Failed to clean 1 worktree");
		expect(stderr.join("")).toContain(worktreePath);
	});

	it("force-deletes an unmerged branch when the user confirms", async () => {
		// Given a repository with a linked worktree that has an unmerged commit.
		const repoRoot = await createRepository();
		const branch = "feature/clean-unmerged-confirm";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		await commitFile(worktreePath, "new.txt", "content", "Unmerged commit");
		let promptedForForce = false;
		const runCleanCommand = createCleanCommand({
			confirmForceDeleteBranch: async () => {
				promptedForForce = true;
				return true;
			},
			confirmRemoval: async () => true,
			promptForWorktrees: async () => [worktreePath],
		});

		// When gji clean runs.
		expect(
			await runCleanCommand({
				cwd: repoRoot,
				stderr: () => undefined,
				stdout: () => undefined,
			}),
		).toBe(0);

		// Then it force-deletes the branch after prompting.
		await expect(pathExists(worktreePath)).resolves.toBe(false);
		await expect(branchExists(repoRoot, branch)).resolves.toBe(false);
		expect(promptedForForce).toBe(true);
	});

	it("removes the worktree and keeps an unmerged branch when force delete is declined", async () => {
		// Given a repository with a linked worktree that has an unmerged commit and a declined force prompt.
		const repoRoot = await createRepository();
		const branch = "feature/clean-unmerged-decline";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		await commitFile(worktreePath, "new.txt", "content", "Unmerged commit");
		const stderr: string[] = [];
		const runCleanCommand = createCleanCommand({
			confirmForceDeleteBranch: async () => false,
			confirmRemoval: async () => true,
			promptForWorktrees: async () => [worktreePath],
		});

		// When gji clean runs and force delete is declined.
		expect(
			await runCleanCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			}),
		).toBe(0);

		// Then the worktree is removed but the branch is preserved, with a message about the kept branch.
		await expect(pathExists(worktreePath)).resolves.toBe(false);
		await expect(branchExists(repoRoot, branch)).resolves.toBe(true);
		expect(stderr.join("")).toContain(branch);
		expect(stderr.join("")).toContain("not deleted");
	});

	it("skips the initial confirmation prompt when force option is set", async () => {
		// Given a repository with a linked worktree and a confirmRemoval that would throw if called.
		const repoRoot = await createRepository();
		const branch = "feature/clean-force-skips-confirm";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		const runCleanCommand = createCleanCommand({
			confirmRemoval: async () => {
				throw new Error("confirmRemoval should not be called with force");
			},
			promptForWorktrees: async () => [worktreePath],
		});

		// When gji clean runs with force.
		expect(
			await runCleanCommand({
				cwd: repoRoot,
				force: true,
				stderr: () => undefined,
				stdout: () => undefined,
			}),
		).toBe(0);

		// Then it removes the worktree without prompting for confirmation.
		await expect(pathExists(worktreePath)).resolves.toBe(false);
	});

	it("continues cleaning after a declined force remove in a batch", async () => {
		// Given a repository with three linked worktrees, the second having an untracked file.
		const repoRoot = await createRepository();
		const firstBranch = "feature/clean-batch-first";
		const dirtyBranch = "feature/clean-batch-dirty";
		const lastBranch = "feature/clean-batch-last";
		const firstWorktreePath = await addLinkedWorktree(repoRoot, firstBranch);
		const dirtyWorktreePath = await addLinkedWorktree(repoRoot, dirtyBranch);
		const lastWorktreePath = await addLinkedWorktree(repoRoot, lastBranch);
		await writeFile(join(dirtyWorktreePath, "untracked.txt"), "dirty");
		const stderr: string[] = [];
		const runCleanCommand = createCleanCommand({
			confirmForceRemoveWorktree: async () => false,
			confirmRemoval: async () => true,
			promptForWorktrees: async () => [
				firstWorktreePath,
				dirtyWorktreePath,
				lastWorktreePath,
			],
		});

		// When gji clean runs and force remove is declined for the dirty worktree.
		expect(
			await runCleanCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			}),
		).toBe(1);

		// Then it removes the remaining clean worktrees and reports the dirty worktree failure.
		await expect(pathExists(firstWorktreePath)).resolves.toBe(false);
		await expect(pathExists(dirtyWorktreePath)).resolves.toBe(true);
		await expect(pathExists(lastWorktreePath)).resolves.toBe(false);
		await expect(branchExists(repoRoot, firstBranch)).resolves.toBe(false);
		await expect(branchExists(repoRoot, dirtyBranch)).resolves.toBe(true);
		await expect(branchExists(repoRoot, lastBranch)).resolves.toBe(false);
		const stderrOutput = stderr.join("");
		expect(stderrOutput).toContain("Failed to clean 1 worktree");
		expect(stderrOutput).toContain(dirtyWorktreePath);
		expect(stderrOutput).not.toContain("Aborted");
	});

	it("continues cleaning after a filesystem deletion failure without deleting that branch", async () => {
		// Given a selected worktree whose parent directory cannot be modified and another clean worktree.
		const repoRoot = await createRepository();
		const failedBranch = "blocked/clean-delete-fails";
		const removedBranch = "other/clean-delete-succeeds";
		const failedWorktreePath = await addLinkedWorktree(repoRoot, failedBranch);
		const removedWorktreePath = await addLinkedWorktree(
			repoRoot,
			removedBranch,
		);
		const failedParent = dirname(failedWorktreePath);
		const stderr: string[] = [];

		await chmod(failedParent, 0o500);

		try {
			// When gji clean runs with force and Git cannot delete one worktree directory.
			expect(
				await createCleanCommand()({
					cwd: repoRoot,
					force: true,
					stderr: (chunk) => stderr.push(chunk),
					stdout: () => undefined,
				}),
			).toBe(1);
		} finally {
			await chmod(failedParent, 0o700);
		}

		// Then it keeps the failed worktree branch, removes the other branch, and reports the failure.
		await expect(pathExists(failedWorktreePath)).resolves.toBe(true);
		await expect(pathExists(removedWorktreePath)).resolves.toBe(false);
		await expect(branchExists(repoRoot, failedBranch)).resolves.toBe(true);
		await expect(branchExists(repoRoot, removedBranch)).resolves.toBe(false);
		const stderrOutput = stderr.join("");
		expect(stderrOutput).toContain("Failed to clean 1 worktree");
		expect(stderrOutput).toContain(failedWorktreePath);
	});

	it("skips force prompts when force option is set", async () => {
		// Given a repository with a dirty linked worktree that has an unmerged commit.
		const repoRoot = await createRepository();
		const branch = "feature/clean-force-flag";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		await writeFile(join(worktreePath, "untracked.txt"), "dirty");
		await commitFile(worktreePath, "new.txt", "content", "Unmerged commit");
		const runCleanCommand = createCleanCommand({
			confirmForceDeleteBranch: async () => {
				throw new Error("should not prompt for force delete");
			},
			confirmForceRemoveWorktree: async () => {
				throw new Error("should not prompt for force remove");
			},
			confirmRemoval: async () => true,
			promptForWorktrees: async () => [worktreePath],
		});

		// When gji clean runs with the force option.
		expect(
			await runCleanCommand({
				cwd: repoRoot,
				force: true,
				stderr: () => undefined,
				stdout: () => undefined,
			}),
		).toBe(0);

		// Then it removes worktree and deletes branch without any force prompts.
		await expect(pathExists(worktreePath)).resolves.toBe(false);
		await expect(branchExists(repoRoot, branch)).resolves.toBe(false);
	});

	describe("--json output", () => {
		it("emits removed worktrees with status and upstream details to stdout on success", async () => {
			// Given a repository with two linked worktrees.
			const repoRoot = await createRepository();
			const branchA = "feature/json-clean-a";
			const branchB = "feature/json-clean-b";
			const pathA = await addLinkedWorktree(repoRoot, branchA);
			const pathB = await addLinkedWorktree(repoRoot, branchB);
			const stdout: string[] = [];
			const stderr: string[] = [];

			// When gji clean --json --force runs.
			const result = await createCleanCommand()({
				cwd: repoRoot,
				force: true,
				json: true,
				stderr: (chunk) => stderr.push(chunk),
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it emits a JSON object listing the removed worktrees; nothing to stderr.
			expect(result).toBe(0);
			expect(stderr).toEqual([]);
			await expect(pathExists(pathA)).resolves.toBe(false);
			await expect(pathExists(pathB)).resolves.toBe(false);
			const output = JSON.parse(stdout.join(""));
			expect(output).toHaveProperty("removed");
			expect(output.removed).toHaveLength(2);
			expect(output.removed).toContainEqual(
				expect.objectContaining({
					branch: branchA,
					lastCommitTimestamp: expect.any(Number),
					path: pathA,
					status: "clean",
					upstream: { kind: "no-upstream" },
				}),
			);
			expect(output.removed).toContainEqual(
				expect.objectContaining({
					branch: branchB,
					lastCommitTimestamp: expect.any(Number),
					path: pathB,
					status: "clean",
					upstream: { kind: "no-upstream" },
				}),
			);
		});

		it("emits { error } to stderr and exits 1 when --force is not set", async () => {
			// Given a repository with a linked worktree.
			const repoRoot = await createRepository();
			await addLinkedWorktree(repoRoot, "feature/json-clean-no-force");
			const stdout: string[] = [];
			const stderr: string[] = [];
			const runCleanCommand = createCleanCommand({
				promptForWorktrees: async () => {
					throw new Error("prompt must not be called in --json mode");
				},
			});

			// When gji clean --json runs without --force.
			const result = await runCleanCommand({
				cwd: repoRoot,
				json: true,
				stderr: (chunk) => stderr.push(chunk),
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it emits a JSON error and exits 1.
			expect(result).toBe(1);
			expect(stdout).toEqual([]);
			const json = JSON.parse(stderr.join(""));
			expect(json).toHaveProperty("error");
		});

		it("includes branch: null for removed detached worktrees", async () => {
			// Given a repository with a detached linked worktree.
			const repoRoot = await createRepository();
			const detachedWorktreePath = `${repoRoot}-json-clean-detached`;
			await runGit(repoRoot, [
				"worktree",
				"add",
				"--detach",
				detachedWorktreePath,
				"HEAD",
			]);
			const stdout: string[] = [];

			// When gji clean --json --force runs.
			const result = await createCleanCommand()({
				cwd: repoRoot,
				force: true,
				json: true,
				stderr: () => undefined,
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then the removed array includes an entry with branch: null.
			expect(result).toBe(0);
			const output = JSON.parse(stdout.join(""));
			expect(output.removed).toContainEqual(
				expect.objectContaining({
					branch: null,
					lastCommitTimestamp: null,
					path: detachedWorktreePath,
					status: "clean",
					upstream: { kind: "detached" },
				}),
			);
		});
	});

	describe("--dry-run", () => {
		it("emits what would be removed without removing anything (text mode)", async () => {
			// Given a repository with a linked worktree.
			const repoRoot = await createRepository();
			const branch = "feature/dry-run-clean-text";
			const worktreePath = await addLinkedWorktree(repoRoot, branch);
			const stdout: string[] = [];
			const runCleanCommand = createCleanCommand({
				confirmRemoval: async () => {
					throw new Error("confirmation must not run in dry-run mode");
				},
				promptForWorktrees: async () => [worktreePath],
			});

			// When gji clean --dry-run runs.
			const result = await runCleanCommand({
				cwd: repoRoot,
				dryRun: true,
				stderr: () => undefined,
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it exits 0 and reports what would be removed without removing.
			expect(result).toBe(0);
			await expect(pathExists(worktreePath)).resolves.toBe(true);
			await expect(branchExists(repoRoot, branch)).resolves.toBe(true);
			const output = stdout.join("");
			expect(output).toContain(worktreePath);
			expect(output).toContain("status: clean");
			expect(output).toContain("upstream: no-upstream");
		});

		it("emits { removed, dryRun: true } to stdout with --json --dry-run", async () => {
			// Given a repository with a linked worktree.
			const repoRoot = await createRepository();
			const branch = "feature/dry-run-clean-json";
			const worktreePath = await addLinkedWorktree(repoRoot, branch);
			const stdout: string[] = [];
			const stderr: string[] = [];

			// When gji clean --json --dry-run runs (selects all candidates automatically).
			const result = await createCleanCommand()({
				cwd: repoRoot,
				dryRun: true,
				json: true,
				stderr: (chunk) => stderr.push(chunk),
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it emits a JSON dry-run result without removing.
			expect(result).toBe(0);
			expect(stderr).toEqual([]);
			await expect(pathExists(worktreePath)).resolves.toBe(true);
			const output = JSON.parse(stdout.join(""));
			expect(output).toHaveProperty("dryRun", true);
			expect(output.removed).toContainEqual(
				expect.objectContaining({
					branch,
					lastCommitTimestamp: expect.any(Number),
					path: worktreePath,
					status: "clean",
					upstream: { kind: "no-upstream" },
				}),
			);
		});

		it("does not require --force in --json --dry-run mode", async () => {
			// Given a repository with a linked worktree.
			const repoRoot = await createRepository();
			await addLinkedWorktree(repoRoot, "feature/dry-run-clean-no-force");
			const stderr: string[] = [];

			// When gji clean --json --dry-run runs without --force.
			const result = await createCleanCommand()({
				cwd: repoRoot,
				dryRun: true,
				json: true,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it succeeds without requiring --force.
			expect(result).toBe(0);
			expect(stderr).toEqual([]);
		});
	});
});

async function branchExists(
	repoRoot: string,
	branch: string,
): Promise<boolean> {
	return (await runGit(repoRoot, ["branch", "--list", branch])) !== "";
}

async function addRemoteTrackedWorktree(
	repoRoot: string,
	branch: string,
): Promise<string> {
	const worktreePath = await addLinkedWorktree(repoRoot, branch);
	await runGit(worktreePath, ["push", "-u", "origin", "HEAD"]);

	return worktreePath;
}

async function deleteRemoteBranch(
	repoRoot: string,
	branch: string,
): Promise<void> {
	await runGit(repoRoot, ["push", "origin", `:${branch}`]);
	await runGit(repoRoot, ["fetch", "--prune", "origin"]);
}
