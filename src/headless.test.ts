import { afterEach, describe, expect, it } from "vitest";

import { createCleanCommand } from "./clean.js";
import { createGoCommand } from "./go.js";
import { isHeadless } from "./headless.js";
import { createNewCommand } from "./new.js";
import { createRemoveCommand } from "./remove.js";
import { addLinkedWorktree, createRepository } from "./repo.test-helpers.js";

afterEach(() => {
	delete process.env.GJI_NO_TUI;
});

describe("isHeadless", () => {
	it("returns false when GJI_NO_TUI is not set", () => {
		// Given GJI_NO_TUI is absent.
		delete process.env.GJI_NO_TUI;
		// Then isHeadless returns false.
		expect(isHeadless()).toBe(false);
	});

	it("returns true when GJI_NO_TUI=1", () => {
		// Given GJI_NO_TUI is set to "1".
		process.env.GJI_NO_TUI = "1";
		// Then isHeadless returns true.
		expect(isHeadless()).toBe(true);
	});

	it('returns false when GJI_NO_TUI is set to a value other than "1"', () => {
		// Given GJI_NO_TUI is set to a truthy but non-"1" value.
		process.env.GJI_NO_TUI = "true";
		// Then isHeadless returns false (requires exact "1").
		expect(isHeadless()).toBe(false);
	});
});

describe("headless mode (GJI_NO_TUI=1)", () => {
	describe("gji new", () => {
		it("errors immediately when no branch argument is given", async () => {
			// Given GJI_NO_TUI=1 is set and no branch argument is provided.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			const stderr: string[] = [];
			const runNewCommand = createNewCommand({
				promptForBranch: async () => {
					throw new Error("prompt must not be called in headless mode");
				},
			});

			// When gji new runs without a branch.
			const result = await runNewCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 with a clear error and never invokes the prompt.
			expect(result).toBe(1);
			expect(stderr.join("")).toMatch(/non-interactive|GJI_NO_TUI/i);
		});

		it("errors immediately when the target path already exists", async () => {
			// Given GJI_NO_TUI=1 is set and a branch that maps to an existing path.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			const branch = "feature/new-headless-conflict";
			await addLinkedWorktree(repoRoot, branch);
			const stderr: string[] = [];
			const runNewCommand = createNewCommand({
				promptForPathConflict: async () => {
					throw new Error(
						"conflict prompt must not be called in headless mode",
					);
				},
			});

			// When gji new runs with a branch whose worktree already exists.
			const result = await runNewCommand({
				branch,
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 with a clear error and never invokes the conflict prompt.
			expect(result).toBe(1);
			expect(stderr.join("")).toMatch(/non-interactive|GJI_NO_TUI/i);
		});

		it("suppresses the install prompt when a package manager is detected", async () => {
			// Given GJI_NO_TUI=1 is set and the new worktree has a detected package manager.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			const branch = "feature/new-headless-install";
			let promptCalled = false;
			const runNewCommand = createNewCommand({
				detectInstallPackageManager: async () => ({
					name: "pnpm",
					installCommand: "pnpm install",
				}),
				promptForInstallChoice: async () => {
					promptCalled = true;
					return "yes";
				},
			});

			// When gji new runs and a package manager is found.
			const result = await runNewCommand({
				branch,
				cwd: repoRoot,
				stderr: () => undefined,
				stdout: () => undefined,
			});

			// Then it succeeds and the install prompt was never shown.
			expect(result).toBe(0);
			expect(promptCalled).toBe(false);
		});
	});

	describe("gji go", () => {
		it("errors immediately when no branch argument is given", async () => {
			// Given GJI_NO_TUI=1 is set and no branch argument is provided.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			await addLinkedWorktree(repoRoot, "feature/go-headless");
			const stderr: string[] = [];
			const runGoCommand = createGoCommand({
				promptForWorktree: async () => {
					throw new Error("prompt must not be called in headless mode");
				},
			});

			// When gji go runs without a branch.
			const result = await runGoCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 with a clear error and never invokes the prompt.
			expect(result).toBe(1);
			expect(stderr.join("")).toMatch(/non-interactive|GJI_NO_TUI/i);
		});
	});

	describe("gji remove", () => {
		it("errors immediately when no branch argument is given", async () => {
			// Given GJI_NO_TUI=1 is set and no branch argument is provided.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			await addLinkedWorktree(repoRoot, "feature/remove-headless-no-branch");
			const stderr: string[] = [];
			const runRemoveCommand = createRemoveCommand({
				promptForWorktree: async () => {
					throw new Error("prompt must not be called in headless mode");
				},
			});

			// When gji remove runs without a branch in headless mode.
			const result = await runRemoveCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 with a clear error and never invokes the prompt.
			expect(result).toBe(1);
			expect(stderr.join("")).toMatch(/non-interactive|GJI_NO_TUI/i);
		});

		it("errors immediately when --force is absent (confirmation required)", async () => {
			// Given GJI_NO_TUI=1 is set, a branch is provided, but --force is absent.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			const branch = "feature/remove-headless-no-force";
			await addLinkedWorktree(repoRoot, branch);
			const stderr: string[] = [];
			const runRemoveCommand = createRemoveCommand({
				confirmRemoval: async () => {
					throw new Error("confirmation must not be called in headless mode");
				},
			});

			// When gji remove runs with a branch but without --force.
			const result = await runRemoveCommand({
				branch,
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 with a clear error without invoking the confirmation prompt.
			expect(result).toBe(1);
			expect(stderr.join("")).toMatch(/non-interactive|GJI_NO_TUI/i);
		});
	});

	describe("gji clean", () => {
		it("errors immediately when --force is absent", async () => {
			// Given GJI_NO_TUI=1 is set and --force is absent.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			await addLinkedWorktree(repoRoot, "feature/clean-headless");
			const stderr: string[] = [];
			const runCleanCommand = createCleanCommand({
				promptForWorktrees: async () => {
					throw new Error("prompt must not be called in headless mode");
				},
			});

			// When gji clean runs without --force in headless mode.
			const result = await runCleanCommand({
				cwd: repoRoot,
				stderr: (chunk) => stderr.push(chunk),
				stdout: () => undefined,
			});

			// Then it exits 1 with a clear error and never invokes the prompt.
			expect(result).toBe(1);
			expect(stderr.join("")).toMatch(/non-interactive|GJI_NO_TUI/i);
		});

		it("removes all candidates without prompting when --force is given", async () => {
			// Given GJI_NO_TUI=1 is set and --force is provided.
			process.env.GJI_NO_TUI = "1";
			const repoRoot = await createRepository();
			await addLinkedWorktree(repoRoot, "feature/clean-force-headless");
			const stdout: string[] = [];
			const runCleanCommand = createCleanCommand({
				promptForWorktrees: async () => {
					throw new Error("prompt must not be called when --force is set");
				},
			});

			// When gji clean --force runs in headless mode.
			const result = await runCleanCommand({
				cwd: repoRoot,
				force: true,
				stderr: () => undefined,
				stdout: (chunk) => stdout.push(chunk),
			});

			// Then it succeeds and removed all linked worktrees without prompting.
			expect(result).toBe(0);
			expect(stdout.join("")).toContain(repoRoot);
		});
	});
});
