import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { registerRepo } from './repo-registry.js';
import { addLinkedWorktree, createRepository, currentBranch } from './repo.test-helpers.js';
import { resolveWarpTarget, runWarpCommand } from './warp.js';

const originalConfigDir = process.env.GJI_CONFIG_DIR;

afterEach(() => {
  if (originalConfigDir === undefined) {
    delete process.env.GJI_CONFIG_DIR;
  } else {
    process.env.GJI_CONFIG_DIR = originalConfigDir;
  }
});

async function makeConfigDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'gji-config-'));
}

describe('resolveWarpTarget', () => {
  it('returns null with an error when no repos are registered', async () => {
    const configDir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = configDir;

    const errors: string[] = [];
    const result = await resolveWarpTarget({
      cwd: '/',
      stderr: (msg) => errors.push(msg),
    });

    expect(result).toBeNull();
    expect(errors.join('')).toMatch(/no repos registered yet/);
  });

  it('uses the commandName prefix in error messages', async () => {
    const configDir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = configDir;

    const errors: string[] = [];
    await resolveWarpTarget({
      commandName: 'gji warp',
      cwd: '/',
      stderr: (msg) => errors.push(msg),
    });

    expect(errors.join('')).toMatch(/^gji warp:/);
  });

  it('resolves a worktree by exact branch name', async () => {
    const configDir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = configDir;

    const repoRoot = await createRepository();
    const worktreePath = await addLinkedWorktree(repoRoot, 'feature/auth');
    await registerRepo(repoRoot);

    const result = await resolveWarpTarget({
      branch: 'feature/auth',
      cwd: '/',
      stderr: () => undefined,
    });

    expect(result).not.toBeNull();
    expect(result!.path).toBe(worktreePath);
    expect(result!.branch).toBe('feature/auth');
  });

  it('resolves a worktree by repo/branch query', async () => {
    const configDir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = configDir;

    const repoRoot = await createRepository();
    const worktreePath = await addLinkedWorktree(repoRoot, 'feature/auth');
    const repoName = repoRoot.split('/').at(-1)!;
    await registerRepo(repoRoot);

    const result = await resolveWarpTarget({
      branch: `${repoName}/feature/auth`,
      cwd: '/',
      stderr: () => undefined,
    });

    expect(result).not.toBeNull();
    expect(result!.path).toBe(worktreePath);
  });

  it('returns null with an error when the branch query has no match', async () => {
    const configDir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = configDir;

    const repoRoot = await createRepository();
    await registerRepo(repoRoot);

    const errors: string[] = [];
    const result = await resolveWarpTarget({
      branch: 'no-such-branch',
      cwd: '/',
      stderr: (msg) => errors.push(msg),
    });

    expect(result).toBeNull();
    expect(errors.join('')).toMatch(/no worktree found matching/);
  });

  it('includes the main worktree in results', async () => {
    const configDir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = configDir;

    const repoRoot = await createRepository();
    await registerRepo(repoRoot);

    const branch = await currentBranch(repoRoot);
    const result = await resolveWarpTarget({
      branch,
      cwd: '/',
      stderr: () => undefined,
    });

    expect(result).not.toBeNull();
    expect(result!.path).toBe(repoRoot);
  });
});

describe('runWarpCommand --json', () => {
  it('outputs JSON error when branch is required but missing', async () => {
    const configDir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = configDir;

    const errors: string[] = [];
    const exitCode = await runWarpCommand({
      cwd: '/',
      json: true,
      stderr: (msg) => errors.push(msg),
      stdout: () => undefined,
    });

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(errors.join(''));
    expect(parsed).toHaveProperty('error');
  });

  it('outputs JSON { branch, path } on success', async () => {
    const configDir = await makeConfigDir();
    process.env.GJI_CONFIG_DIR = configDir;

    const repoRoot = await createRepository();
    const worktreePath = await addLinkedWorktree(repoRoot, 'feature/json-test');
    await registerRepo(repoRoot);

    const outputs: string[] = [];
    const exitCode = await runWarpCommand({
      branch: 'feature/json-test',
      cwd: '/',
      json: true,
      stderr: () => undefined,
      stdout: (msg) => outputs.push(msg),
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(outputs.join(''));
    expect(parsed.branch).toBe('feature/json-test');
    expect(parsed.path).toBe(worktreePath);
  });
});
