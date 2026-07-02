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
