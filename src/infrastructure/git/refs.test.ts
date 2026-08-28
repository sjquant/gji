import { describe, expect, it } from "vitest";
import {
	createRepositoryWithOrigin,
	currentBranch,
	runGit,
} from "../../test-support/repository.js";
import { resolveRemoteBase } from "./refs.js";

describe("resolveRemoteBase", () => {
	it("uses the cached remote HEAD when remote discovery is unavailable", async () => {
		// Given a repository with a cached remote HEAD and an unreachable remote URL.
		const { repoRoot } = await createRepositoryWithOrigin();
		const branch = await currentBranch(repoRoot);
		await runGit(repoRoot, ["remote", "set-head", "origin", "--auto"]);
		await runGit(repoRoot, [
			"remote",
			"set-url",
			"origin",
			"/missing/origin.git",
		]);

		// When the remote base is resolved.
		const base = await resolveRemoteBase(repoRoot, "origin");

		// Then the cached branch is returned without guessing from other refs.
		expect(base).toEqual({ branch, ref: `origin/${branch}` });
	});

	it("returns null instead of guessing when neither remote HEAD nor config identifies a base", async () => {
		// Given a repository with remote-tracking refs but no remote HEAD metadata.
		const { repoRoot } = await createRepositoryWithOrigin();
		await runGit(repoRoot, ["remote", "set-head", "origin", "--auto"]);
		await runGit(repoRoot, [
			"symbolic-ref",
			"--delete",
			"refs/remotes/origin/HEAD",
		]);
		await runGit(repoRoot, [
			"remote",
			"set-url",
			"origin",
			"/missing/origin.git",
		]);

		// When the remote base is resolved without a configured branch.
		const base = await resolveRemoteBase(repoRoot, "origin");

		// Then resolution fails closed instead of selecting an arbitrary branch.
		expect(base).toBeNull();
	});
});
