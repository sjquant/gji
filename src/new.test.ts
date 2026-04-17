import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { GLOBAL_CONFIG_FILE_PATH } from './config.js';
import { resolveWorktreePath } from './repo.js';
import {
  addLinkedWorktree,
  createRepository,
  currentBranch,
  pathExists,
  runGit,
} from './repo.test-helpers.js';
import {
  createNewCommand,
  generateBranchPlaceholder,
  runNewCommand,
} from './new.js';

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
    return;
  }

  process.env.HOME = originalHome;
});

describe('gji new', () => {
  it('creates a branch and linked worktree from the repository root', async () => {
    // Given a repository root and a new branch name.
    const repoRoot = await createRepository();
    const stdout: string[] = [];
    const branchName = 'feature/add-command';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);

    // When gji creates a new worktree for that branch.
    const result = await runCli(['new', branchName], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the branch and worktree exist at the deterministic path.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe(branchName);
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
  });

  it('creates a detached linked worktree without creating a branch', async () => {
    // Given a repository root and a detached worktree name.
    const repoRoot = await createRepository();
    const stdout: string[] = [];
    const worktreeName = 'detached/scratch-pad';
    const worktreePath = resolveWorktreePath(repoRoot, worktreeName);

    // When gji creates a detached worktree for that name.
    const result = await runCli(['new', '--detached', worktreeName], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the detached worktree exists at the deterministic path without a branch.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe('');
    await expect(runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${worktreeName}`]))
      .rejects
      .toThrow();
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
  });

  it('creates the branch from the main repository even when run inside a worktree', async () => {
    // Given an existing linked worktree and a second branch to create.
    const repoRoot = await createRepository();
    const existingBranch = 'feature/existing';
    const existingWorktreePath = await addLinkedWorktree(repoRoot, existingBranch);
    const newBranch = 'feature/from-worktree';
    const newWorktreePath = resolveWorktreePath(repoRoot, newBranch);
    const nestedCwd = join(existingWorktreePath, 'nested');
    await mkdir(nestedCwd, { recursive: true });

    // When gji new runs from inside that linked worktree.
    const result = await runCli(['new', newBranch], {
      cwd: nestedCwd,
    });

    // Then it still creates the new branch/worktree from the main repository.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(newWorktreePath)).resolves.toBe(true);
    await expect(currentBranch(newWorktreePath)).resolves.toBe(newBranch);
  });

  it('writes the created worktree path to the shell output file without printing it', async () => {
    // Given a repository root and a shell output file.
    const repoRoot = await createRepository();
    const branchName = 'feature/new-output-file';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const outputFile = join(repoRoot, 'created-worktree.txt');
    const originalOutputFile = process.env.GJI_NEW_OUTPUT_FILE;
    const stdout: string[] = [];

    process.env.GJI_NEW_OUTPUT_FILE = outputFile;

    try {
      // When gji new runs via the shell-wrapper output file path.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        stderr: () => undefined,
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then it writes the created path to the output file instead of stdout.
      expect(result).toBe(0);
      expect(stdout).toEqual([]);
      await expect(pathExists(worktreePath)).resolves.toBe(true);
      await expect(pathExists(outputFile)).resolves.toBe(true);
      await expect(readFile(outputFile, 'utf8')).resolves.toBe(`${worktreePath}\n`);
    } finally {
      if (originalOutputFile === undefined) {
        delete process.env.GJI_NEW_OUTPUT_FILE;
      } else {
        process.env.GJI_NEW_OUTPUT_FILE = originalOutputFile;
      }
    }
  });

  it('applies a global branch prefix when creating a new worktree', async () => {
    // Given an isolated home directory with a configured default branch prefix.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await createRepository();
    const stdout: string[] = [];
    const branchName = 'add-command';
    const prefixedBranchName = `feature/${branchName}`;
    const worktreePath = resolveWorktreePath(repoRoot, prefixedBranchName);
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    process.env.HOME = home;

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({ branchPrefix: 'feature/' }),
      'utf8',
    );

    // When gji new creates a worktree for an unprefixed branch name.
    const result = await runCli(['new', branchName], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it creates the prefixed branch/worktree from the configured default.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe(prefixedBranchName);
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
  });

  it('prefers a repo-local branch prefix over the global default', async () => {
    // Given global and repo-local branch prefix defaults.
    const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
    const repoRoot = await createRepository();
    const branchName = 'add-command';
    const prefixedBranchName = `repo/${branchName}`;
    const worktreePath = resolveWorktreePath(repoRoot, prefixedBranchName);
    const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
    process.env.HOME = home;

    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      JSON.stringify({ branchPrefix: 'feature/' }),
      'utf8',
    );
    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ branchPrefix: 'repo/' }),
      'utf8',
    );

    // When gji new runs inside that repository.
    const result = await runCli(['new', branchName], {
      cwd: repoRoot,
    });

    // Then the repo-local prefix wins over the global default.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe(prefixedBranchName);
  });

  it('prompts for a branch name with a funny placeholder when none is provided', async () => {
    // Given a repository root and an interactive branch prompt.
    const repoRoot = await createRepository();
    const chosenBranch = 'prometheus-brought-snacks';
    const worktreePath = resolveWorktreePath(repoRoot, chosenBranch);
    const stdout: string[] = [];
    const runNewCommand = createNewCommand({
      createBranchPlaceholder: () => 'socrates-debugged-this',
      promptForBranch: async (placeholder) => {
        expect(placeholder).toBe('socrates-debugged-this');
        return chosenBranch;
      },
    });

    // When gji new runs without an explicit branch.
    const result = await runNewCommand({
      cwd: repoRoot,
      stderr: () => undefined,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it creates the prompted branch/worktree and prints the path.
    expect(result).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe(chosenBranch);
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
  });

  it('uses the generated placeholder for detached worktrees without prompting', async () => {
    // Given a repository root and a detached command without an explicit name.
    const repoRoot = await createRepository();
    const generatedName = 'prometheus-brought-snacks';
    const worktreePath = resolveWorktreePath(repoRoot, generatedName);
    const stdout: string[] = [];
    let promptCalled = false;
    const runNewCommand = createNewCommand({
      createBranchPlaceholder: () => generatedName,
      promptForBranch: async () => {
        promptCalled = true;
        return 'should-not-run';
      },
    });

    // When gji new runs in detached mode without an explicit name.
    const result = await runNewCommand({
      cwd: repoRoot,
      detached: true,
      stderr: () => undefined,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it succeeds without trying to prompt and uses the generated name.
    expect(result).toBe(0);
    expect(promptCalled).toBe(false);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe('');
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
  });

  it('retries detached placeholder names with a suffix when the generated path already exists', async () => {
    // Given a repository root and an auto-generated detached name that already exists.
    const repoRoot = await createRepository();
    const generatedName = 'prometheus-brought-snacks';
    const conflictingPath = resolveWorktreePath(repoRoot, generatedName);
    const retriedPath = resolveWorktreePath(repoRoot, `${generatedName}-2`);
    const stdout: string[] = [];
    let promptCalled = false;
    const runNewCommand = createNewCommand({
      createBranchPlaceholder: () => generatedName,
      promptForBranch: async () => {
        promptCalled = true;
        return 'should-not-run';
      },
    });

    await mkdir(conflictingPath, { recursive: true });

    // When gji new runs in detached mode without an explicit name.
    const result = await runNewCommand({
      cwd: repoRoot,
      detached: true,
      stderr: () => undefined,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it retries with a suffixed name instead of failing or prompting.
    expect(result).toBe(0);
    expect(promptCalled).toBe(false);
    await expect(pathExists(retriedPath)).resolves.toBe(true);
    await expect(currentBranch(retriedPath)).resolves.toBe('');
    expect(stdout.join('')).toBe(`${retriedPath}\n`);
  });

  it('aborts when the branch prompt is cancelled', async () => {
    // Given a repository root and a cancelled branch prompt.
    const repoRoot = await createRepository();
    const stderr: string[] = [];
    const runNewCommand = createNewCommand({
      createBranchPlaceholder: () => 'socrates-debugged-this',
      promptForBranch: async () => null,
    });

    // When gji new runs without an explicit branch and the prompt is cancelled.
    const result = await runNewCommand({
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    // Then it aborts without creating a worktree.
    expect(result).toBe(1);
    expect(stderr.join('')).toBe('Aborted\n');
  });

  it('reuses the existing path when the conflict prompt selects reuse', async () => {
    // Given an existing target path for the requested branch.
    const repoRoot = await createRepository();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const branchName = 'feature/existing-path';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const runNewCommand = createNewCommand({
      promptForPathConflict: async () => 'reuse',
    });

    await mkdir(worktreePath, { recursive: true });

    // When the interactive conflict handler selects reuse.
    const result = await runNewCommand({
      branch: branchName,
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the command exits successfully and returns the existing path.
    expect(result).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
  });

  it('aborts when the conflict prompt selects abort', async () => {
    // Given an existing target path for the requested branch.
    const repoRoot = await createRepository();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const branchName = 'feature/abort-existing-path';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const runNewCommand = createNewCommand({
      promptForPathConflict: async () => 'abort',
    });

    await mkdir(worktreePath, { recursive: true });

    // When the interactive conflict handler selects abort.
    const result = await runNewCommand({
      branch: branchName,
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the command exits without creating or reusing the worktree.
    expect(result).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toBe(
      `Aborted because target worktree path already exists: ${worktreePath}\n`,
    );
  });

  it('creates a linked worktree for a branch that already exists locally', async () => {
    // Given a repository with a local branch that has no worktree checked out yet.
    const repoRoot = await createRepository();
    const stdout: string[] = [];
    const branchName = 'feature/pre-existing-branch';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    await runGit(repoRoot, ['branch', branchName]);

    // When gji new is run for that pre-existing branch.
    const result = await runCli(['new', branchName], {
      cwd: repoRoot,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the worktree is created at the expected path and is checked out to the existing branch.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe(branchName);
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
  });

  describe('syncFiles integration', () => {
    it('copies a configured sync file into the new worktree end-to-end', async () => {
      // Given a repo with a source file and syncFiles config.
      const repoRoot = await createRepository();
      const branchName = 'feature/sync-copy';
      const worktreePath = resolveWorktreePath(repoRoot, branchName);
      await writeFile(join(repoRoot, '.env.example'), 'SECRET=\n', 'utf8');
      await writeFile(join(repoRoot, '.gji.json'), JSON.stringify({ syncFiles: ['.env.example'] }), 'utf8');

      // When creating the worktree.
      const result = await runCli(['new', branchName], { cwd: repoRoot });

      // Then the file is present in the new worktree.
      expect(result.exitCode).toBe(0);
      const content = await readFile(join(worktreePath, '.env.example'), 'utf8');
      expect(content).toBe('SECRET=\n');
    });

    it('skips a sync file whose source does not exist without aborting', async () => {
      // Given a repo with syncFiles pointing to a missing source.
      const repoRoot = await createRepository();
      const branchName = 'feature/sync-missing';
      const worktreePath = resolveWorktreePath(repoRoot, branchName);
      await writeFile(join(repoRoot, '.gji.json'), JSON.stringify({ syncFiles: ['missing.txt'] }), 'utf8');
      const stderr: string[] = [];

      // When creating the worktree.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        stderr: (chunk) => stderr.push(chunk),
        stdout: () => undefined,
      });

      // Then it succeeds, no copy was attempted, and no warning was emitted.
      expect(result).toBe(0);
      expect(stderr).toEqual([]);
      await expect(pathExists(join(worktreePath, 'missing.txt'))).resolves.toBe(false);
    });

    it('emits a warning for an invalid sync pattern but does not abort', async () => {
      // Given a repo with an absolute-path pattern in syncFiles (which syncFiles rejects).
      const repoRoot = await createRepository();
      const branchName = 'feature/sync-invalid';
      const worktreePath = resolveWorktreePath(repoRoot, branchName);
      await writeFile(join(repoRoot, '.gji.json'), JSON.stringify({ syncFiles: ['/etc/passwd'] }), 'utf8');
      const stderr: string[] = [];

      // When creating the worktree.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        stderr: (chunk) => stderr.push(chunk),
        stdout: () => undefined,
      });

      // Then the worktree is still created and a warning is emitted for the bad pattern.
      expect(result).toBe(0);
      await expect(pathExists(worktreePath)).resolves.toBe(true);
      expect(stderr.join('')).toContain('Warning:');
      expect(stderr.join('')).toContain('/etc/passwd');
    });

    it('local syncFiles config overrides global (no array merging)', async () => {
      // Given global config with syncFiles and local config with a different syncFiles.
      const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
      const repoRoot = await createRepository();
      const branchName = 'feature/sync-override';
      const worktreePath = resolveWorktreePath(repoRoot, branchName);
      const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
      process.env.HOME = home;

      await writeFile(join(repoRoot, 'global-file.txt'), 'from global\n', 'utf8');
      await writeFile(join(repoRoot, 'local-file.txt'), 'from local\n', 'utf8');
      await mkdir(dirname(globalConfigPath), { recursive: true });
      await writeFile(globalConfigPath, JSON.stringify({ syncFiles: ['global-file.txt'] }), 'utf8');
      await writeFile(join(repoRoot, '.gji.json'), JSON.stringify({ syncFiles: ['local-file.txt'] }), 'utf8');

      // When creating the worktree.
      const result = await runCli(['new', branchName], { cwd: repoRoot });

      // Then only the local syncFiles list is used (local-file.txt copied, global-file.txt not).
      expect(result.exitCode).toBe(0);
      await expect(pathExists(join(worktreePath, 'local-file.txt'))).resolves.toBe(true);
      await expect(pathExists(join(worktreePath, 'global-file.txt'))).resolves.toBe(false);
    });
  });

  describe('install prompt', () => {
    const fakePm = { name: 'pnpm', installCommand: 'pnpm install' };

    it('runs install once and does not persist anything when "yes" is chosen', async () => {
      // Given a repository with a detected package manager and a "yes" prompt choice.
      const repoRoot = await createRepository();
      const branchName = 'feature/install-yes';
      const installCalls: Array<{ command: string; cwd: string }> = [];
      const runNewCommand = createNewCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'yes',
        runInstallCommand: async (command, cwd) => {
          installCalls.push({ command, cwd });
        },
        writeConfigKey: async () => {
          throw new Error('should not write config');
        },
      });

      // When gji new runs with the "yes" install choice.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then install ran once in the new worktree and nothing was written to config.
      expect(result).toBe(0);
      expect(installCalls).toHaveLength(1);
      expect(installCalls[0].command).toBe('pnpm install');
    });

    it('skips install entirely when "no" is chosen', async () => {
      // Given a repository with a detected package manager and a "no" prompt choice.
      const repoRoot = await createRepository();
      const branchName = 'feature/install-no';
      let installCalled = false;
      let writeConfigCalled = false;
      const runNewCommand = createNewCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'no',
        runInstallCommand: async () => {
          installCalled = true;
        },
        writeConfigKey: async () => {
          writeConfigCalled = true;
        },
      });

      // When gji new runs with the "no" install choice.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then neither install nor a config write happened.
      expect(result).toBe(0);
      expect(installCalled).toBe(false);
      expect(writeConfigCalled).toBe(false);
    });

    it('runs install and writes hooks.afterCreate to local config when "always" is chosen', async () => {
      // Given a repository with a detected package manager and an "always" prompt choice.
      const repoRoot = await createRepository();
      const branchName = 'feature/install-always';
      const writtenKeys: Array<{ key: string; value: unknown }> = [];
      const runNewCommand = createNewCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'always',
        runInstallCommand: async () => undefined,
        writeConfigKey: async (_root, key, value) => {
          writtenKeys.push({ key, value });
        },
      });

      // When gji new runs with the "always" install choice.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then hooks.afterCreate was written to local config with the install command.
      expect(result).toBe(0);
      expect(writtenKeys).toHaveLength(1);
      expect(writtenKeys[0].key).toBe('hooks');
      expect((writtenKeys[0].value as Record<string, unknown>).afterCreate).toBe('pnpm install');
    });

    it('writes skipInstallPrompt:true to local config when "never" is chosen', async () => {
      // Given a repository with a detected package manager and a "never" prompt choice.
      const repoRoot = await createRepository();
      const branchName = 'feature/install-never';
      const writtenKeys: Array<{ key: string; value: unknown }> = [];
      const runNewCommand = createNewCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'never',
        runInstallCommand: async () => undefined,
        writeConfigKey: async (_root, key, value) => {
          writtenKeys.push({ key, value });
        },
      });

      // When gji new runs with the "never" install choice.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then skipInstallPrompt:true was written to local config.
      expect(result).toBe(0);
      expect(writtenKeys).toHaveLength(1);
      expect(writtenKeys[0].key).toBe('skipInstallPrompt');
      expect(writtenKeys[0].value).toBe(true);
    });

    it('suppresses the prompt when skipInstallPrompt is true in effective config', async () => {
      // Given a repository with skipInstallPrompt:true in local config.
      const repoRoot = await createRepository();
      const branchName = 'feature/install-skip-flag';
      let promptCalled = false;
      await writeFile(join(repoRoot, '.gji.json'), JSON.stringify({ skipInstallPrompt: true }), 'utf8');
      const runNewCommand = createNewCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => {
          promptCalled = true;
          return 'yes';
        },
      });

      // When gji new runs with the opt-out flag present.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then no prompt appeared and the command succeeded.
      expect(result).toBe(0);
      expect(promptCalled).toBe(false);
    });

    it('suppresses the prompt when hooks.afterCreate is already set in effective config', async () => {
      // Given a repository with hooks.afterCreate already configured.
      const repoRoot = await createRepository();
      const branchName = 'feature/install-hook-set';
      let promptCalled = false;
      await writeFile(join(repoRoot, '.gji.json'), JSON.stringify({ hooks: { afterCreate: 'npm ci' } }), 'utf8');
      const runNewCommand = createNewCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => {
          promptCalled = true;
          return 'yes';
        },
      });

      // When gji new runs with an afterCreate hook already configured.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then no prompt appeared and the command succeeded.
      expect(result).toBe(0);
      expect(promptCalled).toBe(false);
    });

    it('"always" deep-merges into existing local hooks preserving non-afterCreate keys', async () => {
      // Given a repository with an existing afterEnter hook in local config.
      const repoRoot = await createRepository();
      const branchName = 'feature/install-always-merge';
      const writtenKeys: Array<{ key: string; value: unknown }> = [];
      await writeFile(join(repoRoot, '.gji.json'), JSON.stringify({ hooks: { afterEnter: 'echo entered' } }), 'utf8');
      const runNewCommand = createNewCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'always',
        runInstallCommand: async () => undefined,
        writeConfigKey: async (_root, key, value) => {
          writtenKeys.push({ key, value });
        },
      });

      // When gji new runs with the "always" install choice.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then the written hooks object includes both afterCreate and the preserved afterEnter.
      expect(result).toBe(0);
      const hooks = writtenKeys[0].value as Record<string, unknown>;
      expect(hooks.afterCreate).toBe('pnpm install');
      expect(hooks.afterEnter).toBe('echo entered');
    });

    it('emits a warning and does not abort when writing config fails', async () => {
      // Given a repository where the config write throws on "never".
      const repoRoot = await createRepository();
      const branchName = 'feature/install-write-fail';
      const stderr: string[] = [];
      const runNewCommand = createNewCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'never',
        runInstallCommand: async () => undefined,
        writeConfigKey: async () => {
          throw new Error('read-only filesystem');
        },
      });

      // When gji new runs and the config write fails.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        stderr: (chunk) => stderr.push(chunk),
        stdout: () => undefined,
      });

      // Then the command still succeeds and a warning was emitted to stderr.
      expect(result).toBe(0);
      expect(stderr.join('')).toContain('gji:');
      expect(stderr.join('')).toContain('read-only filesystem');
    });

    it('suppresses the prompt when no package manager is detected', async () => {
      // Given a repository where package-manager detection returns null.
      const repoRoot = await createRepository();
      const branchName = 'feature/install-no-pm';
      let promptCalled = false;
      const runNewCommand = createNewCommand({
        detectInstallPackageManager: async () => null,
        promptForInstallChoice: async () => {
          promptCalled = true;
          return 'yes';
        },
      });

      // When gji new runs and no package manager is found.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then no prompt appeared and the command succeeded.
      expect(result).toBe(0);
      expect(promptCalled).toBe(false);
    });

    it('emits a warning and does not abort when the install command fails', async () => {
      // Given a repository where the install command throws on "yes".
      const repoRoot = await createRepository();
      const branchName = 'feature/install-cmd-fail';
      const stderr: string[] = [];
      const runNewCommand = createNewCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'yes',
        runInstallCommand: async () => {
          throw new Error('command not found');
        },
      });

      // When gji new runs and the install command fails.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        stderr: (chunk) => stderr.push(chunk),
        stdout: () => undefined,
      });

      // Then the command still succeeds and a warning was emitted to stderr.
      expect(result).toBe(0);
      expect(stderr.join('')).toContain('gji:');
      expect(stderr.join('')).toContain('command not found');
    });

    it('writes "always" to per-repo global config when installSaveTarget is "global"', async () => {
      // Given a repo with installSaveTarget: "global" in global config and a detected package manager.
      const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
      const repoRoot = await createRepository();
      const branchName = 'feature/install-global-always';
      const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
      process.env.HOME = home;

      await mkdir(dirname(globalConfigPath), { recursive: true });
      await writeFile(
        globalConfigPath,
        JSON.stringify({ installSaveTarget: 'global' }),
        'utf8',
      );

      const writtenGlobalKeys: Array<{ key: string; value: unknown }> = [];
      let writtenLocalKey = false;
      const runNewCmd = createNewCommand({
        detectInstallPackageManager: async () => ({ name: 'pnpm', installCommand: 'pnpm install' }),
        promptForInstallChoice: async () => 'always',
        runInstallCommand: async () => undefined,
        writeConfigKey: async () => { writtenLocalKey = true; },
        writeGlobalRepoConfigKey: async (_repoRoot, key, value) => {
          writtenGlobalKeys.push({ key, value });
        },
      });

      // When gji new runs with "always" and installSaveTarget: "global".
      const result = await runNewCmd({ branch: branchName, cwd: repoRoot, stderr: () => undefined, stdout: () => undefined });

      // Then hooks.afterCreate is written to the global per-repo config, not local.
      expect(result).toBe(0);
      expect(writtenLocalKey).toBe(false);
      expect(writtenGlobalKeys).toHaveLength(1);
      expect(writtenGlobalKeys[0].key).toBe('hooks');
      expect((writtenGlobalKeys[0].value as Record<string, unknown>).afterCreate).toBe('pnpm install');
    });

    it('writes "never" to per-repo global config when installSaveTarget is "global"', async () => {
      // Given a repo with installSaveTarget: "global" and a detected package manager.
      const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
      const repoRoot = await createRepository();
      const branchName = 'feature/install-global-never';
      const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
      process.env.HOME = home;

      await mkdir(dirname(globalConfigPath), { recursive: true });
      await writeFile(globalConfigPath, JSON.stringify({ installSaveTarget: 'global' }), 'utf8');

      const writtenGlobalKeys: Array<{ key: string; value: unknown }> = [];
      let writtenLocalKey = false;
      const runNewCmd = createNewCommand({
        detectInstallPackageManager: async () => ({ name: 'pnpm', installCommand: 'pnpm install' }),
        promptForInstallChoice: async () => 'never',
        runInstallCommand: async () => undefined,
        writeConfigKey: async () => { writtenLocalKey = true; },
        writeGlobalRepoConfigKey: async (_repoRoot, key, value) => {
          writtenGlobalKeys.push({ key, value });
        },
      });

      // When gji new runs with "never" and installSaveTarget: "global".
      const result = await runNewCmd({ branch: branchName, cwd: repoRoot, stderr: () => undefined, stdout: () => undefined });

      // Then skipInstallPrompt is written to per-repo global config, not local.
      expect(result).toBe(0);
      expect(writtenLocalKey).toBe(false);
      expect(writtenGlobalKeys).toHaveLength(1);
      expect(writtenGlobalKeys[0].key).toBe('skipInstallPrompt');
      expect(writtenGlobalKeys[0].value).toBe(true);
    });

    it('defaults to local when installSaveTarget is absent', async () => {
      // Given a repo with no installSaveTarget configured.
      const repoRoot = await createRepository();
      const branchName = 'feature/install-default-local';
      const writtenLocalKeys: Array<{ key: string; value: unknown }> = [];
      let writtenGlobalKey = false;
      const runNewCmd = createNewCommand({
        detectInstallPackageManager: async () => ({ name: 'pnpm', installCommand: 'pnpm install' }),
        promptForInstallChoice: async () => 'always',
        runInstallCommand: async () => undefined,
        writeConfigKey: async (_root, key, value) => { writtenLocalKeys.push({ key, value }); },
        writeGlobalRepoConfigKey: async () => { writtenGlobalKey = true; },
      });

      // When gji new runs with "always" but no installSaveTarget.
      const result = await runNewCmd({ branch: branchName, cwd: repoRoot, stderr: () => undefined, stdout: () => undefined });

      // Then the existing local write behavior is preserved.
      expect(result).toBe(0);
      expect(writtenGlobalKey).toBe(false);
      expect(writtenLocalKeys).toHaveLength(1);
      expect(writtenLocalKeys[0].key).toBe('hooks');
    });
  });

  describe('--json output', () => {
    it('emits { branch, path } to stdout on success', async () => {
      // Given a repository root and a new branch name.
      const repoRoot = await createRepository();
      const stdout: string[] = [];
      const stderr: string[] = [];
      const branchName = 'feature/json-success';
      const worktreePath = resolveWorktreePath(repoRoot, branchName);

      // When gji new --json succeeds.
      const result = await runCli(['new', '--json', branchName], {
        cwd: repoRoot,
        stderr: (chunk) => stderr.push(chunk),
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then it emits a JSON object with branch and path, nothing to stderr.
      expect(result.exitCode).toBe(0);
      expect(stderr).toEqual([]);
      const output = JSON.parse(stdout.join(''));
      expect(output).toEqual({ branch: branchName, path: worktreePath });
    });

    it('emits { error } to stderr and exits 1 when no branch is provided', async () => {
      // Given a repository root and no branch argument.
      const repoRoot = await createRepository();
      const stdout: string[] = [];
      const stderr: string[] = [];
      const runNewCommand = createNewCommand({
        promptForBranch: async () => {
          throw new Error('prompt must not be called in --json mode');
        },
      });

      // When gji new --json runs without a branch.
      const result = await runNewCommand({
        cwd: repoRoot,
        json: true,
        stderr: (chunk) => stderr.push(chunk),
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then it emits a JSON error to stderr and exits 1 without touching stdout.
      expect(result).toBe(1);
      expect(stdout).toEqual([]);
      const json = JSON.parse(stderr.join(''));
      expect(json).toHaveProperty('error');
      expect(typeof json.error).toBe('string');
    });

    it('emits { error } to stderr and exits 1 when the target path already exists', async () => {
      // Given a repository root and a branch whose worktree path already exists.
      const repoRoot = await createRepository();
      const branchName = 'feature/json-conflict';
      const worktreePath = resolveWorktreePath(repoRoot, branchName);
      const stdout: string[] = [];
      const stderr: string[] = [];
      const runNewCommand = createNewCommand({
        promptForPathConflict: async () => {
          throw new Error('conflict prompt must not be called in --json mode');
        },
      });

      await addLinkedWorktree(repoRoot, branchName);

      // When gji new --json runs with an existing worktree path.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        json: true,
        stderr: (chunk) => stderr.push(chunk),
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then it emits a JSON error mentioning the path and exits 1.
      expect(result).toBe(1);
      expect(stdout).toEqual([]);
      const json = JSON.parse(stderr.join(''));
      expect(json).toHaveProperty('error');
      expect(json.error).toContain(worktreePath);
    });

    it('suppresses the install prompt in --json mode', async () => {
      // Given a repository with a detected package manager.
      const repoRoot = await createRepository();
      const branchName = 'feature/json-no-install-prompt';
      let promptCalled = false;
      const runNewCommand = createNewCommand({
        detectInstallPackageManager: async () => ({ name: 'pnpm', installCommand: 'pnpm install' }),
        promptForInstallChoice: async () => {
          promptCalled = true;
          return 'yes';
        },
      });

      // When gji new --json runs.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        json: true,
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then the install prompt was never shown.
      expect(result).toBe(0);
      expect(promptCalled).toBe(false);
    });
  });

  describe('--dry-run', () => {
    it('emits what would be created without creating anything (text mode)', async () => {
      // Given a repository root and a new branch name.
      const repoRoot = await createRepository();
      const branchName = 'feature/dry-run-text';
      const worktreePath = resolveWorktreePath(repoRoot, branchName);
      const stdout: string[] = [];

      // When gji new --dry-run runs with that branch.
      const result = await runCli(['new', '--dry-run', branchName], {
        cwd: repoRoot,
        stderr: () => undefined,
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then it exits 0 and reports what would be created without creating the worktree.
      expect(result.exitCode).toBe(0);
      await expect(pathExists(worktreePath)).resolves.toBe(false);
      expect(stdout.join('')).toContain(worktreePath);
      expect(stdout.join('')).toContain(branchName);
    });

    it('emits { branch, path, dryRun: true } to stdout with --json --dry-run', async () => {
      // Given a repository root and a new branch name.
      const repoRoot = await createRepository();
      const branchName = 'feature/dry-run-json';
      const worktreePath = resolveWorktreePath(repoRoot, branchName);
      const stdout: string[] = [];
      const stderr: string[] = [];

      // When gji new --json --dry-run runs with that branch.
      const result = await runCli(['new', '--json', '--dry-run', branchName], {
        cwd: repoRoot,
        stderr: (chunk) => stderr.push(chunk),
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then it emits a JSON dry-run result without creating the worktree.
      expect(result.exitCode).toBe(0);
      expect(stderr).toEqual([]);
      await expect(pathExists(worktreePath)).resolves.toBe(false);
      const output = JSON.parse(stdout.join(''));
      expect(output).toEqual({ branch: branchName, path: worktreePath, dryRun: true });
    });

    it('does not run install prompt or hooks in --dry-run mode', async () => {
      // Given a repo where a package manager and afterCreate hook would normally run.
      const repoRoot = await createRepository();
      const branchName = 'feature/dry-run-no-hooks';
      let promptCalled = false;
      const runNewCommand = createNewCommand({
        detectInstallPackageManager: async () => ({ name: 'pnpm', installCommand: 'pnpm install' }),
        promptForInstallChoice: async () => { promptCalled = true; return 'yes'; },
      });

      // When gji new --dry-run runs.
      const result = await runNewCommand({
        branch: branchName,
        cwd: repoRoot,
        dryRun: true,
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then the install prompt was not invoked and no worktree was created.
      expect(result).toBe(0);
      expect(promptCalled).toBe(false);
    });
  });

  describe('Hint: lines', () => {
    afterEach(() => {
      delete process.env.GJI_NO_TUI;
    });

    it('emits a Hint: line when the target path already exists in headless mode', async () => {
      // Given GJI_NO_TUI=1 and a branch whose worktree already exists.
      process.env.GJI_NO_TUI = '1';
      const repoRoot = await createRepository();
      const branch = 'feature/hint-conflict';
      await addLinkedWorktree(repoRoot, branch);
      const stderr: string[] = [];
      const runNewCommand = createNewCommand({
        promptForPathConflict: async () => { throw new Error('must not be called'); },
      });

      // When gji new runs with that conflicting branch in headless mode.
      const result = await runNewCommand({
        branch,
        cwd: repoRoot,
        stderr: (chunk) => stderr.push(chunk),
        stdout: () => undefined,
      });

      // Then it exits 1 and the Hint: line names the exact commands to resolve it.
      expect(result).toBe(1);
      const stderrText = stderr.join('');
      expect(stderrText).toContain('Hint:');
      expect(stderrText).toContain('gji remove');
    });

    it('does NOT emit a Hint: line in --json mode when the target path already exists', async () => {
      // Given a branch whose worktree already exists.
      const repoRoot = await createRepository();
      const branch = 'feature/hint-conflict-json';
      await addLinkedWorktree(repoRoot, branch);
      const stderr: string[] = [];
      const runNewCommand = createNewCommand({
        promptForPathConflict: async () => { throw new Error('must not be called'); },
      });

      // When gji new --json runs with that conflicting branch.
      const result = await runNewCommand({
        branch,
        cwd: repoRoot,
        json: true,
        stderr: (chunk) => stderr.push(chunk),
        stdout: () => undefined,
      });

      // Then it exits 1 with a valid JSON error and no Hint: text mixed in.
      expect(result).toBe(1);
      const json = JSON.parse(stderr.join(''));
      expect(json).toHaveProperty('error');
      expect(stderr.join('')).not.toContain('Hint:');
    });
  });

  describe('worktreePath config', () => {
    it('creates the worktree under a custom base path from config', async () => {
      // Given a local config with a custom worktreePath and a new branch.
      const repoRoot = await createRepository();
      const customBase = await mkdtemp(join(tmpdir(), 'gji-custom-base-'));
      const branchName = 'feature/custom-base';

      await writeFile(
        join(repoRoot, '.gji.json'),
        JSON.stringify({ worktreePath: customBase }),
        'utf8',
      );

      // When gji new creates a worktree.
      const result = await runCli(['new', branchName], { cwd: repoRoot });

      // Then the worktree is created inside the custom base, not the default location.
      expect(result.exitCode).toBe(0);
      await expect(pathExists(join(customBase, 'feature', 'custom-base'))).resolves.toBe(true);
      await expect(pathExists(resolveWorktreePath(repoRoot, branchName))).resolves.toBe(false);
    });

    it('creates the worktree under a tilde-prefixed custom base path from config', async () => {
      // Given a local config with a tilde-prefixed worktreePath under HOME.
      const home = await mkdtemp(join(tmpdir(), 'gji-home-'));
      process.env.HOME = home;
      const repoRoot = await createRepository();
      const branchName = 'feature/tilde-base';

      await writeFile(
        join(repoRoot, '.gji.json'),
        JSON.stringify({ worktreePath: '~/wt' }),
        'utf8',
      );

      // When gji new creates a worktree.
      const result = await runCli(['new', branchName], { cwd: repoRoot });

      // Then the worktree is created under ~/wt/feature/tilde-base.
      expect(result.exitCode).toBe(0);
      await expect(pathExists(join(home, 'wt', 'feature', 'tilde-base'))).resolves.toBe(true);
    });

    it('falls back to default and warns when worktreePath is a relative path', async () => {
      // Given a local config with a relative worktreePath.
      const repoRoot = await createRepository();
      const stderr: string[] = [];
      const branchName = 'feature/relative-base';
      const runNew = createNewCommand({});

      await writeFile(
        join(repoRoot, '.gji.json'),
        JSON.stringify({ worktreePath: 'some/relative/path' }),
        'utf8',
      );

      // When gji new runs.
      const result = await runNew({
        branch: branchName,
        cwd: repoRoot,
        stderr: (chunk) => stderr.push(chunk),
        stdout: () => undefined,
      });

      // Then it exits 0 using the default path and warns about the relative worktreePath.
      expect(result).toBe(0);
      expect(stderr.join('')).toContain('worktreePath');
      expect(stderr.join('')).toContain('some/relative/path');
      await expect(pathExists(resolveWorktreePath(repoRoot, branchName))).resolves.toBe(true);
    });
  });

  describe('branch name validation', () => {
    it('rejects a branch name with a space', async () => {
      // Given a repository and a branch name containing a space.
      const repoRoot = await createRepository();
      const stderr: string[] = [];
      const runNew = createNewCommand({});

      // When gji new is called with that branch name.
      const result = await runNew({
        branch: 'bad branch',
        cwd: repoRoot,
        stderr: (chunk) => stderr.push(chunk),
        stdout: () => undefined,
      });

      // Then it exits 1 with an error about the invalid character.
      expect(result).toBe(1);
      expect(stderr.join('')).toContain('invalid character');
    });

    it('rejects a branch name starting with a dash', async () => {
      // Given a repository and a branch name starting with a dash.
      const repoRoot = await createRepository();
      const stderr: string[] = [];
      const runNew = createNewCommand({});

      // When gji new is called with that branch name.
      const result = await runNew({
        branch: '-bad',
        cwd: repoRoot,
        stderr: (chunk) => stderr.push(chunk),
        stdout: () => undefined,
      });

      // Then it exits 1 with an error about starting with a dash.
      expect(result).toBe(1);
      expect(stderr.join('')).toContain('dash');
    });

    it('emits JSON error for an invalid branch name in --json mode', async () => {
      // Given a repository and --json mode.
      const repoRoot = await createRepository();
      const stderr: string[] = [];
      const runNew = createNewCommand({});

      // When gji new --json is called with an invalid branch name.
      const result = await runNew({
        branch: 'bad..branch',
        cwd: repoRoot,
        json: true,
        stderr: (chunk) => stderr.push(chunk),
        stdout: () => undefined,
      });

      // Then it exits 1 and the stderr is valid JSON with an error field.
      expect(result).toBe(1);
      const json = JSON.parse(stderr.join(''));
      expect(json).toHaveProperty('error');
    });

    it('does not validate the name as a branch name for detached worktrees', async () => {
      // Detached worktree names are directory names, not branch names — git naming
      // rules don't apply, so names that would be invalid branches (e.g. containing
      // a dot prefix on a segment) are still accepted as worktree directory names.
      const repoRoot = await createRepository();
      const runNew = createNewCommand({});

      // When gji new --detach is called with a name that would fail branch validation.
      const result = await runNew({
        branch: 'scratch',
        cwd: repoRoot,
        detached: true,
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then it exits 0 (detached names skip branch-rule validation).
      expect(result).toBe(0);
    });
  });

  it('generates funny placeholder names as slug-safe mythic human-style branches', () => {
    // Given deterministic random choices.
    const placeholders = [
      generateBranchPlaceholder(() => 0),
      generateBranchPlaceholder(() => 0.49),
      generateBranchPlaceholder(() => 0.99),
    ];

    // Then the generated names stay slug-safe and use the curated funny roots.
    for (const placeholder of placeholders) {
      expect(placeholder).toMatch(/^[a-z0-9-]+$/);
      expect(placeholder.split('-')[0]).toMatch(
        /^(socrates|prometheus|beethoven|ada|turing|hypatia|tesla|curie|diogenes|plato|hephaestus|athena|archimedes|euclid|heraclitus|galileo|newton|lovelace|nietzsche|kafka)$/,
      );
      expect(placeholder.split('-').length).toBeGreaterThan(1);
    }
  });
});
