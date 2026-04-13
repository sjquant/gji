import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import { resolveWorktreePath } from './repo.js';
import { createRepository } from './repo.test-helpers.js';

describe('gji trigger-hook', () => {
  it('runs the afterCreate hook in the current worktree', async () => {
    // Given a linked worktree with an afterCreate hook configured.
    const repoRoot = await createRepository();
    const branchName = 'feature/trigger-test';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const markerFile = join(worktreePath, '.hook-ran');

    await runCli(['new', branchName], { cwd: repoRoot });
    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { afterCreate: `touch "${markerFile}"` } }),
      'utf8',
    );

    // When trigger-hook is run with afterCreate from inside that worktree.
    const result = await runCli(['trigger-hook', 'afterCreate'], { cwd: worktreePath });

    // Then the hook ran inside the worktree.
    expect(result.exitCode).toBe(0);
    await expect(readFile(markerFile)).resolves.toBeDefined();
  });

  it('runs the afterEnter hook in the current worktree', async () => {
    // Given a linked worktree with an afterEnter hook configured.
    const repoRoot = await createRepository();
    const branchName = 'feature/trigger-enter';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const markerFile = join(worktreePath, '.enter-hook-ran');

    await runCli(['new', branchName], { cwd: repoRoot });
    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { afterEnter: `touch "${markerFile}"` } }),
      'utf8',
    );

    // When trigger-hook is run with afterEnter.
    const result = await runCli(['trigger-hook', 'afterEnter'], { cwd: worktreePath });

    // Then the afterEnter hook ran.
    expect(result.exitCode).toBe(0);
    await expect(readFile(markerFile)).resolves.toBeDefined();
  });

  it('runs the beforeRemove hook in the current worktree', async () => {
    // Given a linked worktree with a beforeRemove hook configured.
    const repoRoot = await createRepository();
    const branchName = 'feature/trigger-remove';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const markerFile = join(worktreePath, '.remove-hook-ran');

    await runCli(['new', branchName], { cwd: repoRoot });
    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { beforeRemove: `touch "${markerFile}"` } }),
      'utf8',
    );

    // When trigger-hook is run with beforeRemove.
    const result = await runCli(['trigger-hook', 'beforeRemove'], { cwd: worktreePath });

    // Then the beforeRemove hook ran.
    expect(result.exitCode).toBe(0);
    await expect(readFile(markerFile)).resolves.toBeDefined();
  });

  it('succeeds silently when the requested hook is not configured', async () => {
    // Given a worktree with no hooks in the config.
    const repoRoot = await createRepository();
    const branchName = 'feature/no-hooks';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);

    await runCli(['new', branchName], { cwd: repoRoot });

    // When trigger-hook is called for a hook that is not configured.
    const stderr: string[] = [];
    const result = await runCli(['trigger-hook', 'afterCreate'], {
      cwd: worktreePath,
      stderr: (c) => stderr.push(c),
    });

    // Then the command succeeds without error.
    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
  });

  it('sets the correct context variables for the hook', async () => {
    // Given an afterCreate hook that writes env vars to a file.
    const repoRoot = await createRepository();
    const branchName = 'feature/ctx-check';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);
    const outputFile = join(worktreePath, 'ctx.txt');

    await runCli(['new', branchName], { cwd: repoRoot });
    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({
        hooks: {
          afterCreate: `printf '%s:%s:%s' "$GJI_BRANCH" "$GJI_PATH" "$GJI_REPO" > "${outputFile}"`,
        },
      }),
      'utf8',
    );

    // When trigger-hook fires the hook.
    await runCli(['trigger-hook', 'afterCreate'], { cwd: worktreePath });

    // Then GJI_BRANCH, GJI_PATH, and GJI_REPO are correctly set.
    const output = await readFile(outputFile, 'utf8');
    const [branch, path, repo] = output.split(':');
    expect(branch).toBe(branchName);
    expect(path).toBe(worktreePath);
    expect(repo).toBe(repoRoot.split('/').at(-1));
  });

  it('emits a warning but exits 0 when the hook command fails', async () => {
    // Given a worktree with a failing afterCreate hook.
    const repoRoot = await createRepository();
    const branchName = 'feature/fail-hook';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);

    await runCli(['new', branchName], { cwd: repoRoot });
    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { afterCreate: 'exit 7' } }),
      'utf8',
    );

    // When trigger-hook is run with the failing hook.
    const stderr: string[] = [];
    const result = await runCli(['trigger-hook', 'afterCreate'], {
      cwd: worktreePath,
      stderr: (c) => stderr.push(c),
    });

    // Then the command still exits 0 and emits a warning.
    expect(result.exitCode).toBe(0);
    expect(stderr.join('')).toContain('hook exited with code 7');
  });

  it('errors on an unknown hook name', async () => {
    // Given a valid repository.
    const repoRoot = await createRepository();
    const branchName = 'feature/bad-hook';
    const worktreePath = resolveWorktreePath(repoRoot, branchName);

    await runCli(['new', branchName], { cwd: repoRoot });

    // When trigger-hook is called with an unrecognised hook name.
    const stderr: string[] = [];
    const result = await runCli(['trigger-hook', 'onSpookyEvent'], {
      cwd: worktreePath,
      stderr: (c) => stderr.push(c),
    });

    // Then the command exits non-zero with a helpful message.
    expect(result.exitCode).toBe(1);
    expect(stderr.join('')).toContain('onSpookyEvent');
  });

  it('works from the main repo root (not only from linked worktrees)', async () => {
    // Given a hook configured at the repo root.
    const repoRoot = await createRepository();
    const markerFile = join(repoRoot, '.main-hook-ran');

    await writeFile(
      join(repoRoot, '.gji.json'),
      JSON.stringify({ hooks: { afterCreate: `touch "${markerFile}"` } }),
      'utf8',
    );

    // When trigger-hook is run from the main repo root.
    const result = await runCli(['trigger-hook', 'afterCreate'], { cwd: repoRoot });

    // Then the hook runs in the main worktree too.
    expect(result.exitCode).toBe(0);
    await expect(readFile(markerFile)).resolves.toBeDefined();
  });
});
