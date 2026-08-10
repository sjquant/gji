import { describe, expect, it } from "vitest";
import type { ContextCardModel } from "../../application/worktree/context-card.js";
import { renderContextCard } from "./context-card.js";

describe("renderContextCard", () => {
	it("renders the task, health state, upstream counts, and last commit", () => {
		// Given a complete current-worktree context model.
		const model: ContextCardModel = {
			info: {
				branch: "feature/card",
				isCurrent: true,
				lastCommitTimestamp: Date.parse("2026-01-02T03:04:05.000Z"),
				path: "/repo/worktree",
				slot: 1,
				status: "clean",
				task: "review the architecture",
				upstream: { kind: "tracked", ahead: 2, behind: 1 },
			},
			task: "review the architecture",
		};

		// When the terminal presentation renders the model.
		const output = renderContextCard(model);

		// Then every user-facing context field appears in the card.
		expect(output).toContain("feature/card");
		expect(output).toContain("review the architecture");
		expect(output).toContain("clean · ↑2 ↓1");
		expect(output).toContain("2026-01-02T03:04:05.000Z");
	});
});
