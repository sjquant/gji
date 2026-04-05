import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { createPrCommand, parsePrInput, runPrCommand } from './pr.js';
import { resolveWorktreePath } from './repo.js';
import {
  addLinkedWorktree,
  commitFile,
  createRepository,
  createRepositoryWithOrigin,
  currentBranch,
  pathExists,
  pushPullRequestRef,
  runGit,
} from './repo.test-helpers.js';

describe('parsePrInput', () => {
  it.each([
    ['123', '123'],
    ['#123', '123'],
    ['https://github.com/owner/repo/pull/123', '123'],
    ['https://github.com/owner/repo/pull/123/files', '123'],
    ['https://gitlab.com/owner/repo/-/merge_requests/456', '456'],
    ['https://gitlab.mycompany.com/group/sub/repo/-/merge_requests/789', '789'],
    ['https://bitbucket.org/owner/repo/pull-requests/321', '321'],
  ])('parses %s as PR number %s', (input, expected) => {
    expect(parsePrInput(input)).toBe(expected);
  });

  it.each([
    ['abc'],
    ['not-a-url'],
    [''],
  ])('returns null for unrecognized input %s', (input) => {
    expect(parsePrInput(input)).toBeNull();
  });
});

describe('gji pr', () => {
  it('fetches a PR ref from origin and creates a linked worktree', async () => {
    // Given a repository with an origin remote exposing refs/pull/123/head.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branchName = 'feature/pr-source';
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/123');

    await runGit(repoRoot, ['checkout', '-b', branchName]);
    await commitFile(repoRoot, 'pr-change.txt', 'pr body\n', 'pr source');
    await pushPullRequestRef(repoRoot, '123');
    await runGit(repoRoot, ['checkout', '-']);

    // When gji pr fetches that pull request.
    const result = await runCli(['pr', '123'], {
      cwd: repoRoot,
    });

    // Then it creates a local pr/123 worktree at the deterministic path.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe('pr/123');
  });

  it('works from inside an existing linked worktree', async () => {
    // Given a repository with both an existing worktree and a PR ref on origin.
    const { repoRoot } = await createRepositoryWithOrigin();
    const existingBranch = 'feature/existing-pr-worktree';
    const existingWorktreePath = await addLinkedWorktree(repoRoot, existingBranch);
    const prBranch = 'feature/pr-from-worktree';
    const prWorktreePath = resolveWorktreePath(repoRoot, 'pr/456');
    const nestedCwd = join(existingWorktreePath, 'nested');

    await runGit(repoRoot, ['checkout', '-b', prBranch]);
    await commitFile(
      repoRoot,
      'pr-from-worktree.txt',
      'pr from worktree\n',
      'pr from worktree',
    );
    await pushPullRequestRef(repoRoot, '456');
    await runGit(repoRoot, ['checkout', '-']);
    await mkdir(nestedCwd, { recursive: true });

    // When gji pr runs from inside that linked worktree.
    const result = await runCli(['pr', '456'], {
      cwd: nestedCwd,
    });

    // Then it still creates the PR worktree from the main repository.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(prWorktreePath)).resolves.toBe(true);
    await expect(currentBranch(prWorktreePath)).resolves.toBe('pr/456');
  });

  it('writes the created worktree path to the shell output file without printing it', async () => {
    // Given a repository with a PR ref and a shell output file.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branchName = 'feature/pr-output-file';
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/789');
    const outputFile = join(repoRoot, 'pr-output.txt');
    const originalOutputFile = process.env.GJI_PR_OUTPUT_FILE;
    const stdout: string[] = [];

    await runGit(repoRoot, ['checkout', '-b', branchName]);
    await commitFile(repoRoot, 'pr-output.txt', 'pr output\n', 'pr output');
    await pushPullRequestRef(repoRoot, '789');
    await runGit(repoRoot, ['checkout', '-']);

    process.env.GJI_PR_OUTPUT_FILE = outputFile;

    try {
      // When gji pr runs via the shell-wrapper output file path.
      const result = await runPrCommand({
        cwd: repoRoot,
        number: '789',
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
        delete process.env.GJI_PR_OUTPUT_FILE;
      } else {
        process.env.GJI_PR_OUTPUT_FILE = originalOutputFile;
      }
    }
  });

  it('reuses the existing worktree path when the conflict prompt selects reuse', async () => {
    // Given a repository with an existing target path for the PR worktree.
    const repoRoot = await createRepository();
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/999');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const runPrCommand = createPrCommand({
      promptForPathConflict: async () => 'reuse',
    });

    await mkdir(worktreePath, { recursive: true });

    // When the interactive conflict handler selects reuse.
    const result = await runPrCommand({
      cwd: repoRoot,
      number: '999',
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the command exits successfully and returns the existing path.
    expect(result).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('')).toBe(`${worktreePath}\n`);
  });

  it('aborts when the conflict prompt selects abort', async () => {
    // Given a repository with an existing target path for the PR worktree.
    const repoRoot = await createRepository();
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/888');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const runPrCommand = createPrCommand({
      promptForPathConflict: async () => 'abort',
    });

    await mkdir(worktreePath, { recursive: true });

    // When the interactive conflict handler selects abort.
    const result = await runPrCommand({
      cwd: repoRoot,
      number: '888',
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then the command exits without creating the worktree.
    expect(result).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join('')).toBe(
      `Aborted because target worktree path already exists: ${worktreePath}\n`,
    );
  });

  it('rejects unrecognized input', async () => {
    // Given a repository and an unrecognizable PR reference.
    const repoRoot = await createRepository();
    const stderr: string[] = [];

    // When gji pr is called with an unrecognized argument.
    const result = await runPrCommand({
      cwd: repoRoot,
      number: 'abc',
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    // Then it exits with an error without touching git.
    expect(result).toBe(1);
    expect(stderr.join('')).toContain('abc');
  });

  it('accepts a GitHub PR URL', async () => {
    // Given a repository with a PR ref on origin.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branchName = 'feature/url-input';
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/555');

    await runGit(repoRoot, ['checkout', '-b', branchName]);
    await commitFile(repoRoot, 'url-input.txt', 'url input\n', 'url input');
    await pushPullRequestRef(repoRoot, '555');
    await runGit(repoRoot, ['checkout', '-']);

    // When gji pr is called with a full GitHub URL.
    const result = await runCli(['pr', 'https://github.com/owner/repo/pull/555'], {
      cwd: repoRoot,
    });

    // Then it creates the worktree by extracting the PR number from the URL.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe('pr/555');
  });

  it('accepts a #-prefixed PR number', async () => {
    // Given a repository with a PR ref on origin.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branchName = 'feature/hash-input';
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/777');

    await runGit(repoRoot, ['checkout', '-b', branchName]);
    await commitFile(repoRoot, 'hash-input.txt', 'hash input\n', 'hash input');
    await pushPullRequestRef(repoRoot, '777');
    await runGit(repoRoot, ['checkout', '-']);

    // When gji pr is called with a #-prefixed number.
    const result = await runCli(['pr', '#777'], { cwd: repoRoot });

    // Then it creates the worktree correctly.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe('pr/777');
  });

  it('reports a clear error when the PR does not exist on origin', async () => {
    // Given a repository with an origin remote but no PR ref for number 9999.
    const { repoRoot } = await createRepositoryWithOrigin();
    const stderr: string[] = [];

    // When gji pr tries to fetch a non-existent PR.
    const result = await runPrCommand({
      cwd: repoRoot,
      number: '9999',
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    // Then it exits with an error mentioning the PR number.
    expect(result).toBe(1);
    expect(stderr.join('')).toContain('9999');
  });

  it('attaches to an existing pr branch instead of recreating it', async () => {
    // Given a repository where the pr/123 branch already exists locally but has no worktree.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branchName = 'feature/pre-existing-pr-branch';
    const worktreePath = resolveWorktreePath(repoRoot, 'pr/123');

    await runGit(repoRoot, ['checkout', '-b', branchName]);
    await commitFile(repoRoot, 'pre-existing.txt', 'pre-existing\n', 'pre-existing');
    await pushPullRequestRef(repoRoot, '123');
    await runGit(repoRoot, ['checkout', '-']);
    // Fetch the ref and create the local branch manually (simulating a previous run that cleaned up the worktree)
    await runGit(repoRoot, ['fetch', 'origin', 'refs/pull/123/head:refs/remotes/origin/pull/123/head']);
    await runGit(repoRoot, ['branch', 'pr/123', 'refs/remotes/origin/pull/123/head']);

    // When gji pr runs and the pr/123 branch already exists.
    const result = await runCli(['pr', '123'], { cwd: repoRoot });

    // Then it creates the worktree by attaching to the existing branch without error.
    expect(result.exitCode).toBe(0);
    await expect(pathExists(worktreePath)).resolves.toBe(true);
    await expect(currentBranch(worktreePath)).resolves.toBe('pr/123');
  });

  describe('--json output', () => {
    it('emits { branch, path } to stdout on success', async () => {
      // Given a repository with a PR ref on origin.
      const { repoRoot } = await createRepositoryWithOrigin();
      const branchName = 'feature/json-pr-source';
      const worktreePath = resolveWorktreePath(repoRoot, 'pr/3001');
      const stdout: string[] = [];
      const stderr: string[] = [];

      await runGit(repoRoot, ['checkout', '-b', branchName]);
      await commitFile(repoRoot, 'json-pr.txt', 'json pr\n', 'json pr');
      await pushPullRequestRef(repoRoot, '3001');
      await runGit(repoRoot, ['checkout', '-']);

      // When gji pr --json succeeds.
      const result = await runCli(['pr', '--json', '3001'], {
        cwd: repoRoot,
        stderr: (chunk) => stderr.push(chunk),
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then it emits a JSON object with branch and path, nothing to stderr.
      expect(result.exitCode).toBe(0);
      expect(stderr).toEqual([]);
      const output = JSON.parse(stdout.join(''));
      expect(output).toEqual({ branch: 'pr/3001', path: worktreePath });
    });

    it('emits { error } to stderr and exits 1 for an invalid PR reference', async () => {
      // Given a repository and an unrecognizable PR reference.
      const repoRoot = await createRepository();
      const stdout: string[] = [];
      const stderr: string[] = [];

      // When gji pr --json is called with invalid input.
      const result = await runCli(['pr', '--json', 'not-a-pr'], {
        cwd: repoRoot,
        stderr: (chunk) => stderr.push(chunk),
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then it emits a JSON error to stderr and exits 1 without touching stdout.
      expect(result.exitCode).toBe(1);
      expect(stdout).toEqual([]);
      const json = JSON.parse(stderr.join(''));
      expect(json).toHaveProperty('error');
      expect(typeof json.error).toBe('string');
    });

    it('emits { error } to stderr and exits 1 when the PR fetch fails', async () => {
      // Given a repository with an origin remote but no PR ref for number 9998.
      const { repoRoot } = await createRepositoryWithOrigin();
      const stdout: string[] = [];
      const stderr: string[] = [];

      // When gji pr --json tries to fetch a non-existent PR.
      const result = await runPrCommand({
        cwd: repoRoot,
        json: true,
        number: '9998',
        stderr: (chunk) => stderr.push(chunk),
        stdout: (chunk) => stdout.push(chunk),
      });

      // Then it emits a JSON error mentioning the PR number.
      expect(result).toBe(1);
      expect(stdout).toEqual([]);
      const json = JSON.parse(stderr.join(''));
      expect(json).toHaveProperty('error');
      expect(json.error).toContain('9998');
    });

    it('suppresses the install prompt in --json mode', async () => {
      // Given a repository with a PR ref and a detected package manager.
      const { repoRoot } = await createRepositoryWithOrigin();
      await runGit(repoRoot, ['checkout', '-b', 'feature/json-pr-install']);
      await commitFile(repoRoot, 'json-install.txt', 'content\n', 'json install');
      await pushPullRequestRef(repoRoot, '3002');
      await runGit(repoRoot, ['checkout', '-']);
      let promptCalled = false;
      const runPrCmd = createPrCommand({
        detectInstallPackageManager: async () => ({ name: 'pnpm', installCommand: 'pnpm install' }),
        promptForInstallChoice: async () => {
          promptCalled = true;
          return 'yes';
        },
      });

      // When gji pr --json runs.
      const result = await runPrCmd({
        cwd: repoRoot,
        json: true,
        number: '3002',
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then the install prompt was never shown.
      expect(result).toBe(0);
      expect(promptCalled).toBe(false);
    });
  });

  describe('install prompt', () => {
    const fakePm = { name: 'pnpm', installCommand: 'pnpm install' };

    async function setupPrRepo(prNumber: string): Promise<string> {
      const { repoRoot } = await createRepositoryWithOrigin();
      await runGit(repoRoot, ['checkout', '-b', `feature/install-pr-${prNumber}`]);
      await commitFile(repoRoot, `pr-install-${prNumber}.txt`, 'content\n', `pr ${prNumber}`);
      await pushPullRequestRef(repoRoot, prNumber);
      await runGit(repoRoot, ['checkout', '-']);
      return repoRoot;
    }

    it('runs install once and does not persist anything when "yes" is chosen', async () => {
      // Given a PR repo with a detected package manager and a "yes" prompt choice.
      const repoRoot = await setupPrRepo('2001');
      const installCalls: Array<{ command: string; cwd: string }> = [];
      const runPrCmd = createPrCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'yes',
        runInstallCommand: async (command, cwd) => {
          installCalls.push({ command, cwd });
        },
        writeConfigKey: async () => {
          throw new Error('should not write config');
        },
      });

      // When gji pr runs with the "yes" install choice.
      const result = await runPrCmd({
        cwd: repoRoot,
        number: '2001',
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then install ran once in the new worktree and nothing was written to config.
      expect(result).toBe(0);
      expect(installCalls).toHaveLength(1);
      expect(installCalls[0].command).toBe('pnpm install');
      expect(installCalls[0].cwd).toBe(resolveWorktreePath(repoRoot, 'pr/2001'));
    });

    it('skips install entirely when "no" is chosen', async () => {
      // Given a PR repo with a detected package manager and a "no" prompt choice.
      const repoRoot = await setupPrRepo('2002');
      let installCalled = false;
      let writeConfigCalled = false;
      const runPrCmd = createPrCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'no',
        runInstallCommand: async () => { installCalled = true; },
        writeConfigKey: async () => { writeConfigCalled = true; },
      });

      // When gji pr runs with the "no" install choice.
      const result = await runPrCmd({
        cwd: repoRoot,
        number: '2002',
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then neither install nor a config write happened.
      expect(result).toBe(0);
      expect(installCalled).toBe(false);
      expect(writeConfigCalled).toBe(false);
    });

    it('runs install and writes hooks.afterCreate to local config when "always" is chosen', async () => {
      // Given a PR repo with a detected package manager and an "always" prompt choice.
      const repoRoot = await setupPrRepo('2003');
      const writtenKeys: Array<{ key: string; value: unknown }> = [];
      const runPrCmd = createPrCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'always',
        runInstallCommand: async () => undefined,
        writeConfigKey: async (_root, key, value) => {
          writtenKeys.push({ key, value });
        },
      });

      // When gji pr runs with the "always" install choice.
      const result = await runPrCmd({
        cwd: repoRoot,
        number: '2003',
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
      // Given a PR repo with a detected package manager and a "never" prompt choice.
      const repoRoot = await setupPrRepo('2004');
      const writtenKeys: Array<{ key: string; value: unknown }> = [];
      const runPrCmd = createPrCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'never',
        runInstallCommand: async () => undefined,
        writeConfigKey: async (_root, key, value) => {
          writtenKeys.push({ key, value });
        },
      });

      // When gji pr runs with the "never" install choice.
      const result = await runPrCmd({
        cwd: repoRoot,
        number: '2004',
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
      // Given a PR repo with skipInstallPrompt:true in local config.
      const repoRoot = await setupPrRepo('2005');
      let promptCalled = false;
      await writeFile(join(repoRoot, '.gji.json'), JSON.stringify({ skipInstallPrompt: true }), 'utf8');
      const runPrCmd = createPrCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => {
          promptCalled = true;
          return 'yes';
        },
      });

      // When gji pr runs with the opt-out flag present.
      const result = await runPrCmd({
        cwd: repoRoot,
        number: '2005',
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then no prompt appeared and the command succeeded.
      expect(result).toBe(0);
      expect(promptCalled).toBe(false);
    });

    it('suppresses the prompt when hooks.afterCreate is already set in effective config', async () => {
      // Given a PR repo with hooks.afterCreate already configured.
      const repoRoot = await setupPrRepo('2006');
      let promptCalled = false;
      await writeFile(join(repoRoot, '.gji.json'), JSON.stringify({ hooks: { afterCreate: 'npm ci' } }), 'utf8');
      const runPrCmd = createPrCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => {
          promptCalled = true;
          return 'yes';
        },
      });

      // When gji pr runs with an afterCreate hook already configured.
      const result = await runPrCmd({
        cwd: repoRoot,
        number: '2006',
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then no prompt appeared and the command succeeded.
      expect(result).toBe(0);
      expect(promptCalled).toBe(false);
    });

    it('"always" deep-merges into existing local hooks preserving non-afterCreate keys', async () => {
      // Given a PR repo with an existing afterEnter hook in local config.
      const repoRoot = await setupPrRepo('2007');
      const writtenKeys: Array<{ key: string; value: unknown }> = [];
      await writeFile(join(repoRoot, '.gji.json'), JSON.stringify({ hooks: { afterEnter: 'echo entered' } }), 'utf8');
      const runPrCmd = createPrCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'always',
        runInstallCommand: async () => undefined,
        writeConfigKey: async (_root, key, value) => {
          writtenKeys.push({ key, value });
        },
      });

      // When gji pr runs with the "always" install choice.
      const result = await runPrCmd({
        cwd: repoRoot,
        number: '2007',
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then the written hooks object includes both afterCreate and the preserved afterEnter.
      expect(result).toBe(0);
      expect(writtenKeys).toHaveLength(1);
      const hooks = writtenKeys[0].value as Record<string, unknown>;
      expect(hooks.afterCreate).toBe('pnpm install');
      expect(hooks.afterEnter).toBe('echo entered');
    });

    it('emits a warning and does not abort when writing config fails', async () => {
      // Given a PR repo where the config write throws on "never".
      const repoRoot = await setupPrRepo('2008');
      const stderr: string[] = [];
      const runPrCmd = createPrCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'never',
        runInstallCommand: async () => undefined,
        writeConfigKey: async () => {
          throw new Error('read-only filesystem');
        },
      });

      // When gji pr runs and the config write fails.
      const result = await runPrCmd({
        cwd: repoRoot,
        number: '2008',
        stderr: (chunk) => stderr.push(chunk),
        stdout: () => undefined,
      });

      // Then the command still succeeds and a warning was emitted to stderr.
      expect(result).toBe(0);
      expect(stderr.join('')).toContain('gji:');
      expect(stderr.join('')).toContain('read-only filesystem');
    });

    it('suppresses the prompt when no package manager is detected', async () => {
      // Given a PR repo where package-manager detection returns null.
      const repoRoot = await setupPrRepo('2009');
      let promptCalled = false;
      const runPrCmd = createPrCommand({
        detectInstallPackageManager: async () => null,
        promptForInstallChoice: async () => {
          promptCalled = true;
          return 'yes';
        },
      });

      // When gji pr runs and no package manager is found.
      const result = await runPrCmd({
        cwd: repoRoot,
        number: '2009',
        stderr: () => undefined,
        stdout: () => undefined,
      });

      // Then no prompt appeared and the command succeeded.
      expect(result).toBe(0);
      expect(promptCalled).toBe(false);
    });

    it('emits a warning and does not abort when the install command fails', async () => {
      // Given a PR repo where the install command throws on "yes".
      const repoRoot = await setupPrRepo('2010');
      const stderr: string[] = [];
      const runPrCmd = createPrCommand({
        detectInstallPackageManager: async () => fakePm,
        promptForInstallChoice: async () => 'yes',
        runInstallCommand: async () => {
          throw new Error('command not found');
        },
      });

      // When gji pr runs and the install command fails.
      const result = await runPrCmd({
        cwd: repoRoot,
        number: '2010',
        stderr: (chunk) => stderr.push(chunk),
        stdout: () => undefined,
      });

      // Then the command still succeeds and a warning was emitted to stderr.
      expect(result).toBe(0);
      expect(stderr.join('')).toContain('gji:');
      expect(stderr.join('')).toContain('command not found');
    });
  });
});
