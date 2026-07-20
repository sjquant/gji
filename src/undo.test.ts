import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { listWorktrees } from "./repo.js";
import {
	addLinkedWorktree,
	createRepository,
	createRepositoryWithOrigin,
	pathExists,
	runGit,
} from "./repo.test-helpers.js";
import {
	recordUndoOperation,
	restoreUndoRecord,
	runUndoCommand,
	undoLogPath,
} from "./undo.js";

describe("gji undo", () => {
	it("reports an upstream restoration failure as a partial failure", async () => {
		// Given a removed worktree whose branch tracked a remote branch that was deleted.
		const { repoRoot } = await createRepositoryWithOrigin();
		const branch = "feature/undo-upstream-failure";
		const worktreePath = await addLinkedWorktree(repoRoot, branch);
		await runGit(worktreePath, ["push", "-u", "origin", branch]);
		const worktree = (await listWorktrees(repoRoot)).find(
			(entry) => entry.path === worktreePath,
		);
		expect(worktree).toBeDefined();
		const record = await recordUndoOperation("done", repoRoot, [worktree!]);
		expect(record).not.toBeNull();
		await runGit(repoRoot, ["worktree", "remove", worktreePath]);
		await runGit(repoRoot, ["branch", "-D", branch]);
		await runGit(repoRoot, ["push", "origin", `:${branch}`]);
		await runGit(repoRoot, ["fetch", "--prune", "origin"]);

		// When undo restores the journaled worktree.
		const result = await restoreUndoRecord(record!);

		// Then it reports the missing upstream while preserving the partial record.
		expect(result.restored.map((entry) => entry.branch)).toEqual([branch]);
		expect(result.failed[0]?.message).toContain("could not restore upstream");
		await expect(pathExists(worktreePath)).resolves.toBe(true);
		const journal = JSON.parse(await readFile(undoLogPath(), "utf8")) as Array<{
			entries: unknown[];
		}>;
		expect(journal[0]?.entries).toHaveLength(1);
	});

	it("does not restore another repository without explicit confirmation", async () => {
		// Given a latest undo record belonging to a different repository.
		const firstRepository = await createRepository();
		const branch = "feature/undo-other-repo";
		const worktreePath = await addLinkedWorktree(firstRepository, branch);
		const worktree = (await listWorktrees(firstRepository)).find(
			(entry) => entry.path === worktreePath,
		);
		expect(worktree).toBeDefined();
		await expect(
			recordUndoOperation("remove", firstRepository, [worktree!]),
		).resolves.not.toBeNull();
		const secondRepository = await createRepository();
		const stderr: string[] = [];
		const stdout: string[] = [];

		// When headless JSON undo runs from the second repository without an id.
		const result = await runUndoCommand({
			cwd: secondRepository,
			json: true,
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it refuses the cross-repository record and leaves the first worktree alone.
		expect(result).toBe(1);
		expect(stderr.join("")).toContain("use --id");
		await expect(pathExists(worktreePath)).resolves.toBe(true);
	});

	it("reports garbage-collected commits with an actionable error", async () => {
		// Given an undo record pointing at a commit that no longer exists.
		const repoRoot = await createRepository();
		const home = await mkdtemp(join(tmpdir(), "gji-undo-home-"));
		process.env.GJI_CONFIG_DIR = home;
		await writeFile(
			undoLogPath(),
			`${JSON.stringify([
				{
					id: "u-gc-test",
					op: "done",
					repoRoot,
					timestamp: Date.now(),
					entries: [
						{
							branch: "feature/gc",
							headSha: "deadbeef",
							path: join(home, "missing-worktree"),
							upstream: null,
							wasDirty: false,
						},
					],
				},
			])}\n`,
		);
		const stderr: string[] = [];
		const stdout: string[] = [];

		// When JSON undo attempts the restore.
		const result = await runUndoCommand({
			cwd: repoRoot,
			json: true,
			stderr: (chunk) => stderr.push(chunk),
			stdout: (chunk) => stdout.push(chunk),
		});

		// Then it reports that garbage collection removed the commit.
		expect(result).toBe(1);
		expect(`${stdout.join("")}${stderr.join("")}`).toContain(
			"commit no longer exists",
		);
	});
});
