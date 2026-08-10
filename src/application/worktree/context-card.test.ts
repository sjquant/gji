import { describe, expect, it } from "vitest";
import type { WorktreeInfo } from "../../domain/worktree/types.js";
import { loadContextCardModel } from "./context-card.js";

describe("loadContextCardModel", () => {
	it("returns the current worktree information when a task exists", async () => {
		// Given a worktree with health metadata and a task.
		const info = createInfo();

		// When the application loads the context-card model.
		const model = await loadContextCardModel("/repo/worktree", {
			listWorktrees: async () => [info],
			readTask: async () => ({ task: "review the architecture" }),
			readWorktreeInfo: async () => info,
		});

		// Then the presentation receives a complete, infrastructure-free model.
		expect(model).toEqual({ info, task: "review the architecture" });
	});

	it("returns no card model when task metadata is absent", async () => {
		// Given a worktree without task metadata.
		const info = createInfo();

		// When the application loads the context-card model.
		const model = await loadContextCardModel("/repo/worktree", {
			listWorktrees: async () => [info],
			readTask: async () => null,
			readWorktreeInfo: async () => info,
		});

		// Then no empty card is presented.
		expect(model).toBeNull();
	});
});

function createInfo(): WorktreeInfo {
	return {
		branch: "feature/card",
		isCurrent: true,
		lastCommitTimestamp: null,
		path: "/repo/worktree",
		slot: 1,
		status: "clean",
		task: null,
		upstream: { kind: "tracked", ahead: 0, behind: 0 },
	};
}
