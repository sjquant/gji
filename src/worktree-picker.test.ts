import { PassThrough, Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";

import { describe, expect, it } from "vitest";

import {
	promptForMultipleWorktrees,
	promptForSingleWorktree,
	type WorktreePickerIO,
	type WorktreePromptEntry,
} from "./worktree-picker.js";

describe("worktree picker search", () => {
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
