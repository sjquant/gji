import { PassThrough, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";

import { describe, expect, it } from "vitest";
import { addLinkedWorktree, createRepository } from "./repo.test-helpers.js";
import { writeTask } from "./task.js";
import {
	buildWorktreePromptEntries,
	promptForMultipleWorktrees,
	promptForSingleWorktree,
	type WorktreePickerIO,
	type WorktreePromptEntry,
} from "./worktree-picker.js";

describe("worktree picker search", () => {
	it("renders and searches PR numbers attached to a worktree", async () => {
		// Given a worktree whose fresh PR lookup returns two open PRs.
		const repoRoot = await createRepository();
		const entries = await buildWorktreePromptEntries(
			[
				{
					repoRoot,
					repoName: "repo",
					worktree: {
						branch: "feature/review",
						isCurrent: true,
						path: repoRoot,
					},
				},
			],
			{
				queryPullRequests: async (_root, sourceBranch) => [
					{
						number: 34,
						sourceBranch,
						url: "https://example.com/pull/34",
					},
					{
						number: 12,
						sourceBranch,
						url: "https://example.com/pull/12",
					},
				],
			},
		);
		const { input, output } = createPromptIO();
		const choice = promptForSingleWorktree("Choose a worktree", entries, {
			input,
			output,
		});

		// When the user searches by the second PR number.
		input.write("/#12\r");

		// Then the PR badge is sorted, rendered, and searchable without changing the path value.
		await expect(choice).resolves.toBe(repoRoot);
		expect(entries[0].pullRequestNumbers).toEqual([12, 34]);
		expect(entries[0].pullRequestUrls).toEqual([
			"https://example.com/pull/12",
			"https://example.com/pull/34",
		]);
		expect(output.text()).toContain("feature/review (#12, #34)");
	});

	it("renders and searches a worktree task while safely truncating its row", async () => {
		// Given a worktree with a long task summary.
		const repoRoot = await createRepository();
		const task =
			"Fix the login redirect after the session expires without losing the original destination";
		await writeTask(repoRoot, task);
		const entries = await buildWorktreePromptEntries(
			[
				{
					repoRoot,
					repoName: "repo",
					worktree: {
						branch: "feature/login",
						isCurrent: true,
						path: repoRoot,
					},
				},
			],
			{ queryPullRequests: async () => [] },
		);
		const { input, output } = createPromptIO();
		output.columns = 48;
		const choice = promptForSingleWorktree("Choose a worktree", entries, {
			input,
			output,
		});

		// When the user searches by text that only occurs in the task.
		input.write("/redirect\r");

		// Then the task-bearing worktree is selected and the visible row stays bounded.
		await expect(choice).resolves.toBe(repoRoot);
		expect(entries[0].task).toBe(task);
		const rendered = stripVTControlCharacters(output.text());
		expect(rendered).toContain("redirect");
		expect(rendered).toContain("…");
		expect(rendered).not.toContain(task);
	});

	it("builds a fast all-repositories scope without status or PR lookups", async () => {
		// Given a worktree and metadata lookups that would fail if invoked.
		const source = {
			repoRoot: "/repo",
			repoName: "repo",
			worktree: worktreeEntry("feature/fast", "/repo/fast"),
		};
		let branchQueryCount = 0;
		let repositoryQueryCount = 0;

		// When fast prompt entries are built for the all-repositories scope.
		const entries = await buildWorktreePromptEntries([source], {
			metadata: "fast",
			queryPullRequests: async () => {
				branchQueryCount += 1;
				return [];
			},
			queryRepositoryPullRequests: async () => {
				repositoryQueryCount += 1;
				return [];
			},
		});

		// Then it preserves the selectable identity without running expensive lookups.
		expect(branchQueryCount).toBe(0);
		expect(repositoryQueryCount).toBe(0);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			branch: "feature/fast",
			path: "/repo/fast",
			pullRequestNumbers: [],
		});
	});

	it("keeps task metadata searchable in a fast all-repositories scope", async () => {
		// Given a worktree with task metadata and a fast picker scope.
		const repoRoot = await createRepository();
		await writeTask(repoRoot, "find the login redirect");
		const entries = await buildWorktreePromptEntries(
			[
				{
					repoRoot,
					repoName: "repo",
					worktree: {
						branch: "feature/fast-task",
						isCurrent: false,
						path: repoRoot,
					},
				},
			],
			{ metadata: "fast" },
		);
		const { input, output } = createPromptIO();
		const choice = promptForSingleWorktree("Choose a worktree", entries, {
			input,
			output,
		});

		// When the user searches task text without full metadata hydration.
		input.write("/redirect\r");

		// Then the fast picker still finds the task-bearing worktree.
		await expect(choice).resolves.toBe(repoRoot);
	});

	it("queries each repository once and joins PRs by source branch", async () => {
		// Given two worktrees from one repository and repository-scoped PR metadata.
		const repoRoot = await createRepository();
		const branchA = "feature/repository-a";
		const branchB = "feature/repository-b";
		const pathA = await addLinkedWorktree(repoRoot, branchA);
		const pathB = await addLinkedWorktree(repoRoot, branchB);
		const queriedRoots: string[] = [];

		// When the shared picker builds its entries.
		const entries = await buildWorktreePromptEntries(
			[
				{
					repoRoot,
					repoName: "repo",
					worktree: { branch: branchA, isCurrent: true, path: pathA },
				},
				{
					repoRoot,
					repoName: "repo",
					worktree: { branch: branchB, isCurrent: false, path: pathB },
				},
			],
			{
				queryRepositoryPullRequests: async (root) => {
					queriedRoots.push(root);
					return [
						{
							number: 12,
							sourceBranch: branchB,
							url: "https://example.com/pull/12",
						},
					];
				},
			},
		);

		// Then one repository lookup decorates only the matching branch.
		expect(queriedRoots).toEqual([repoRoot]);
		expect(
			entries.find((entry) => entry.path === pathA)?.pullRequestNumbers,
		).toEqual([]);
		expect(
			entries.find((entry) => entry.path === pathB)?.pullRequestNumbers,
		).toEqual([12]);
	});

	it("filters single-select choices after slash search", async () => {
		// Given a searchable worktree picker with two branches.
		const { input, output } = createPromptIO();
		const worktrees = [
			worktreeEntry("feature/billing", "/repo/billing"),
			worktreeEntry("feature/auth", "/repo/auth"),
		];
		const choice = promptForSingleWorktree("Choose a worktree", worktrees, {
			input,
			output,
		});

		// When the user presses "/" and types a matching branch fragment.
		input.write("/auth\r");

		// Then the filtered worktree is selected with Enter.
		await expect(choice).resolves.toBe("/repo/auth");
		expect(output.text()).toContain("/auth");
	});

	it("toggles from the current repository to all repositories with Tab", async () => {
		// Given a scoped worktree picker with a worktree outside the initial repository.
		const { input, output } = createPromptIO();
		const current = worktreeEntry("feature/current", "/repo/current");
		const global = worktreeEntry("feature/other", "/other/feature");
		let toggleCount = 0;
		const choice = promptForSingleWorktree("Choose a worktree", [current], {
			input,
			output,
			scope: {
				label: "current repository",
				toggleLabel: "all repositories",
				toggle: async () => {
					toggleCount += 1;
					return {
						entries: [global],
						label: "all repositories",
						toggleLabel: "current repository",
					};
				},
			},
		});

		// When the user switches scope and selects the newly loaded worktree.
		input.write("\t");
		await nextTick();
		input.write("\r");

		// Then the picker returns the worktree from the all-repositories scope.
		expect(await choice).toBe(global.path);
		expect(toggleCount).toBe(1);
		expect(output.text()).toContain("all repositories");
	});

	it("filters multi-select choices after slash search", async () => {
		// Given a searchable multi-select worktree picker with grouped branches.
		const { input, output } = createPromptIO();
		const worktrees = [
			worktreeEntry("feature/billing", "/repo/billing"),
			worktreeEntry("feature/auth", "/repo/auth"),
		];
		const choices = promptForMultipleWorktrees("Choose worktrees", worktrees, {
			input,
			output,
		});

		// When the user filters to one branch, toggles it, and submits.
		input.write("/auth \r");

		// Then only the filtered worktree is selected.
		await expect(choices).resolves.toEqual(["/repo/auth"]);
		expect(output.text()).toContain("/auth");
	});

	it("starts grouped multi-select prompts on the first selectable worktree", async () => {
		// Given a grouped multi-select worktree picker.
		const { input, output } = createPromptIO();
		const worktrees = [
			worktreeEntry("feature/billing", "/repo/billing"),
			worktreeEntry("feature/auth", "/repo/auth"),
		];
		const choices = promptForMultipleWorktrees("Choose worktrees", worktrees, {
			input,
			output,
		});

		// When the user toggles the initial row and submits without moving first.
		input.write(" \r");

		// Then the first selectable worktree is selected instead of the group header.
		await expect(choices).resolves.toEqual(["/repo/billing"]);
		expect(output.text()).toContain("feature/billing");
	});

	it("shows validation when grouped multi-select submits no worktrees", async () => {
		// Given a grouped multi-select worktree picker with no selected values.
		const { input, output } = createPromptIO();
		const worktrees = [
			worktreeEntry("feature/billing", "/repo/billing"),
			worktreeEntry("feature/auth", "/repo/auth"),
		];
		const choices = promptForMultipleWorktrees("Choose worktrees", worktrees, {
			input,
			output,
		});

		// When the user submits without selecting, then selects the initial row.
		input.write("\r");
		await nextTick();
		input.write(" \r");

		// Then the prompt shows the validation error before returning the selection.
		await expect(choices).resolves.toEqual(["/repo/billing"]);
		expect(output.text()).toContain("Please select at least one option.");
	});

	it("cancels single-select prompts with escape", async () => {
		// Given a single-select worktree picker.
		const { input, output } = createPromptIO();
		const choice = promptForSingleWorktree(
			"Choose a worktree",
			[worktreeEntry("feature/billing", "/repo/billing")],
			{ input, output },
		);

		// When the user presses Escape outside search mode.
		input.write("\u001b");

		// Then the prompt resolves to null.
		await expect(choice).resolves.toBeNull();
	});

	it("cancels multi-select prompts with ctrl-c", async () => {
		// Given a multi-select worktree picker.
		const { input, output } = createPromptIO();
		const choices = promptForMultipleWorktrees(
			"Choose worktrees",
			[worktreeEntry("feature/billing", "/repo/billing")],
			{ input, output },
		);

		// When the user presses Ctrl-C.
		input.write("\u0003");

		// Then the prompt resolves to null.
		await expect(choices).resolves.toBeNull();
	});

	it("ellipsizes long labels before rendering worktree choices", async () => {
		// Given a narrow worktree picker with a label that would otherwise soft-wrap.
		const { input, output } = createPromptIO();
		output.columns = 48;
		const longBranch = `feature/${"very-long-branch-name-".repeat(4)}`;
		const longPath = `/repo/${"deeply/nested/".repeat(6)}worktree`;
		const choice = promptForSingleWorktree(
			"Choose a worktree",
			[worktreeEntry(longBranch, longPath)],
			{ input, output },
		);

		// When the user submits the first worktree.
		input.write("\r");

		// Then the rendered choice is shortened instead of printing the full row.
		await expect(choice).resolves.toBe(longPath);
		const rendered = stripVTControlCharacters(output.text());
		expect(rendered).toContain("…");
		expect(rendered).not.toContain(longBranch);
		expect(rendered).not.toContain(longPath);
	});

	it("keeps full long label text searchable while showing an active preview", async () => {
		// Given a narrow searchable picker with long branch and path labels.
		const { input, output } = createPromptIO();
		output.columns = 56;
		const selectedPath =
			"/repo/deeply/nested/unique-visible-tail-selected-worktree";
		const choice = promptForSingleWorktree(
			"Choose a worktree",
			[
				worktreeEntry(
					"feature/very-long-unrelated-branch-name",
					"/repo/deeply/nested/unrelated-worktree",
				),
				worktreeEntry("feature/very-long-selected-branch-name", selectedPath),
			],
			{ input, output },
		);

		// When the user searches by text that is only present in the full path.
		input.write("/unique-visible-tail\r");

		// Then the full search text is preserved and the active item preview is shown.
		await expect(choice).resolves.toBe(selectedPath);
		const rendered = stripVTControlCharacters(output.text());
		expect(rendered).toContain("current ");
		expect(rendered).toContain("unique-visible-tail");
		expect(rendered).toContain("selected-worktree");
		expect(rendered).toContain("…");
		expect(rendered).not.toContain(selectedPath);
	});

	it("keeps task text visible when a picker row is narrow", async () => {
		// Given a narrow picker with a task-bearing worktree that is not active.
		const { input, output } = createPromptIO();
		output.columns = 36;
		const choice = promptForSingleWorktree(
			"Choose a worktree",
			[
				worktreeEntry("feature/current", "/repo/current"),
				{
					...worktreeEntry("feature/task", "/repo/task"),
					task: "task-visible-summary",
				},
			],
			{ input, output },
		);
		await nextTick();

		// When the picker renders its initial rows.
		const rendered = stripVTControlCharacters(output.text());

		// Then the task remains visible even after lower-priority context is removed.
		expect(rendered).toContain("task-vis");

		input.write("\u001b");
		await expect(choice).resolves.toBeNull();
	});

	it("sanitizes control characters in task labels without changing search text", async () => {
		// Given a task containing a newline and terminal escape sequence.
		const { input, output } = createPromptIO();
		const task = "line one\n\u001b[31munsafe";
		const choice = promptForSingleWorktree(
			"Choose a worktree",
			[
				{
					...worktreeEntry("feature/safe-task", "/repo/safe-task"),
					task,
				},
			],
			{ input, output },
		);

		// When the user searches by the original task text.
		input.write("/unsafe\r");

		// Then search still matches, while the row cannot inject terminal control output.
		await expect(choice).resolves.toBe("/repo/safe-task");
		expect(output.text()).not.toContain("\u001b[31m");
		expect(output.text()).not.toContain(task);
	});

	it("ellipsizes wide glyph labels by terminal display width", async () => {
		// Given a narrow picker with wide glyphs in branch and path text.
		const { input, output } = createPromptIO();
		output.columns = 36;
		const wideBranch = `기능/${"긴브랜치".repeat(6)}`;
		const widePath = `/repo/${"깊은/".repeat(8)}작업트리`;
		const choice = promptForSingleWorktree(
			"Choose a worktree",
			[worktreeEntry(wideBranch, widePath)],
			{ input, output },
		);

		// When the user submits the first worktree.
		input.write("\r");

		// Then the full wide label is not printed into a soft-wrapping row.
		await expect(choice).resolves.toBe(widePath);
		const rendered = stripVTControlCharacters(output.text());
		expect(rendered).toContain("…");
		expect(rendered).not.toContain(wideBranch);
		expect(rendered).not.toContain(widePath);
	});
});

function createPromptIO(): Required<WorktreePickerIO> & {
	input: PromptInput;
	output: PromptOutput;
} {
	const input = new PassThrough() as PromptInput;
	input.isTTY = true;
	input.setRawMode = () => undefined;

	return {
		input,
		output: new PromptOutput(),
	};
}

type PromptInput = PassThrough & {
	isTTY: boolean;
	setRawMode: (mode: boolean) => void;
};

class PromptOutput extends Writable {
	columns = 120;
	rows = 24;
	private readonly chunks: string[] = [];

	text(): string {
		return this.chunks.join("");
	}

	_write(
		chunk: Buffer | string,
		_encoding: BufferEncoding,
		callback: (error?: Error | null) => void,
	): void {
		this.chunks.push(chunk.toString());
		callback();
	}
}

function worktreeEntry(branch: string, path: string): WorktreePromptEntry {
	return {
		branch,
		group: "other",
		isCurrent: false,
		label: `repo · ${branch} · ${path}`,
		path,
		repoName: "repo",
	};
}

function nextTick(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
