import { afterEach, describe, expect, it } from 'vitest';

import { createCleanCommand } from './clean.js';
import { createGoCommand } from './go.js';
import { createNewCommand } from './new.js';
import { createRemoveCommand } from './remove.js';
import { addLinkedWorktree, createRepository } from './repo.test-helpers.js';

afterEach(() => {
  delete process.env.GJI_NO_TUI;
  delete process.env.NO_COLOR;
});

describe('headless mode (GJI_NO_TUI=1)', () => {
  describe('gji new', () => {
    it('errors immediately when no branch argument is given', async () => {
      // Given GJI_NO_TUI=1 is set and no branch argument is provided.
      process.env.GJI_NO_TUI = '1';
      const repoRoot = await createRepository();
      const stderr: string[] = [];
      const runNewCommand = createNewCommand({
        promptForBranch: async () => {
          throw new Error('prompt must not be called in headless mode');
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
      expect(stderr.join('')).toMatch(/non-interactive|headless|GJI_NO_TUI/i);
    });
  });

  describe('gji go', () => {
    it('errors immediately when no branch argument is given', async () => {
      // Given GJI_NO_TUI=1 is set and no branch argument is provided.
      process.env.GJI_NO_TUI = '1';
      const repoRoot = await createRepository();
      await addLinkedWorktree(repoRoot, 'feature/go-headless');
      const stderr: string[] = [];
      const runGoCommand = createGoCommand({
        promptForWorktree: async () => {
          throw new Error('prompt must not be called in headless mode');
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
      expect(stderr.join('')).toMatch(/non-interactive|headless|GJI_NO_TUI/i);
    });
  });

  describe('gji remove', () => {
    it('errors immediately when no branch argument is given', async () => {
      // Given GJI_NO_TUI=1 is set and no branch argument is provided.
      process.env.GJI_NO_TUI = '1';
      const repoRoot = await createRepository();
      await addLinkedWorktree(repoRoot, 'feature/remove-headless-no-branch');
      const stderr: string[] = [];
      const runRemoveCommand = createRemoveCommand({
        promptForWorktree: async () => {
          throw new Error('prompt must not be called in headless mode');
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
      expect(stderr.join('')).toMatch(/non-interactive|headless|GJI_NO_TUI/i);
    });

    it('errors immediately when --force is absent (confirmation required)', async () => {
      // Given GJI_NO_TUI=1 is set, a branch is provided, but --force is absent.
      process.env.GJI_NO_TUI = '1';
      const repoRoot = await createRepository();
      const branch = 'feature/remove-headless-no-force';
      await addLinkedWorktree(repoRoot, branch);
      const stderr: string[] = [];
      const runRemoveCommand = createRemoveCommand({
        confirmRemoval: async () => {
          throw new Error('confirmation must not be called in headless mode');
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
      expect(stderr.join('')).toMatch(/non-interactive|headless|GJI_NO_TUI/i);
    });
  });

  describe('gji clean', () => {
    it('errors immediately when --force is absent', async () => {
      // Given GJI_NO_TUI=1 is set and --force is absent.
      process.env.GJI_NO_TUI = '1';
      const repoRoot = await createRepository();
      await addLinkedWorktree(repoRoot, 'feature/clean-headless');
      const stderr: string[] = [];
      const runCleanCommand = createCleanCommand({
        promptForWorktrees: async () => {
          throw new Error('prompt must not be called in headless mode');
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
      expect(stderr.join('')).toMatch(/non-interactive|headless|GJI_NO_TUI/i);
    });
  });
});

describe('headless mode (NO_COLOR)', () => {
  it('gji new errors when NO_COLOR is set and no branch is given', async () => {
    // Given NO_COLOR is set (e.g. by CI) and no branch argument is provided.
    process.env.NO_COLOR = '';
    const repoRoot = await createRepository();
    const stderr: string[] = [];
    const runNewCommand = createNewCommand({
      promptForBranch: async () => {
        throw new Error('prompt must not be called in headless mode');
      },
    });

    // When gji new runs without a branch.
    const result = await runNewCommand({
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    // Then it exits 1 with a clear error.
    expect(result).toBe(1);
    expect(stderr.join('')).toMatch(/non-interactive|headless|NO_COLOR/i);
  });
});
