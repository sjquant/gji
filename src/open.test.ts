import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createOpenCommand } from './open.js';
import { addLinkedWorktree, createRepository, pathExists } from './repo.test-helpers.js';

function makeSpawnEditor(spawned: { cli: string; args: string[] }[]): (cli: string, args: string[]) => Promise<void> {
  return async (cli, args) => {
    spawned.push({ cli, args });
  };
}

describe('gji open', () => {
  it('opens the current worktree in the specified editor', async () => {
    const repoRoot = await createRepository();
    const spawned: { cli: string; args: string[] }[] = [];
    const stdout: string[] = [];

    const result = await createOpenCommand({ spawnEditor: makeSpawnEditor(spawned) })({
      cwd: repoRoot,
      editor: 'code',
      stderr: () => undefined,
      stdout: (chunk) => stdout.push(chunk),
    });

    expect(result).toBe(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].cli).toBe('code');
    expect(spawned[0].args).toContain('--new-window');
    expect(spawned[0].args).toContain(repoRoot);
    expect(stdout.join('')).toContain('VS Code');
  });

  it('opens a linked worktree by branch name', async () => {
    const repoRoot = await createRepository();
    const branch = 'feature/open-test';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    const spawned: { cli: string; args: string[] }[] = [];

    const result = await createOpenCommand({ spawnEditor: makeSpawnEditor(spawned) })({
      branch,
      cwd: repoRoot,
      editor: 'cursor',
      stderr: () => undefined,
      stdout: () => undefined,
    });

    expect(result).toBe(0);
    expect(spawned[0].args).toContain(worktreePath);
  });

  it('exits 1 when the requested branch has no worktree', async () => {
    const repoRoot = await createRepository();
    const stderr: string[] = [];

    const result = await createOpenCommand({ spawnEditor: makeSpawnEditor([]) })({
      branch: 'nonexistent',
      cwd: repoRoot,
      editor: 'code',
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    expect(result).toBe(1);
    expect(stderr.join('')).toContain('nonexistent');
    expect(stderr.join('')).toContain('gji ls');
  });

  it('exits 1 when no editor is detected or configured', async () => {
    const repoRoot = await createRepository();
    const stderr: string[] = [];

    const result = await createOpenCommand({
      detectEditors: async () => [],
      spawnEditor: makeSpawnEditor([]),
    })({
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    expect(result).toBe(1);
    expect(stderr.join('')).toContain('no supported editor detected');
  });

  it('auto-selects the only detected editor without prompting', async () => {
    const repoRoot = await createRepository();
    const spawned: { cli: string; args: string[] }[] = [];
    let promptCalled = false;

    const result = await createOpenCommand({
      detectEditors: async () => [{ cli: 'zed', name: 'Zed', supportsWorkspace: false }],
      promptForEditor: async () => { promptCalled = true; return null; },
      spawnEditor: makeSpawnEditor(spawned),
    })({
      cwd: repoRoot,
      stderr: () => undefined,
      stdout: () => undefined,
    });

    expect(result).toBe(0);
    expect(promptCalled).toBe(false);
    expect(spawned[0].cli).toBe('zed');
  });

  it('prompts when multiple editors are detected and uses the selection', async () => {
    const repoRoot = await createRepository();
    const spawned: { cli: string; args: string[] }[] = [];

    const result = await createOpenCommand({
      detectEditors: async () => [
        { cli: 'cursor', name: 'Cursor', newWindowFlag: '--new-window', supportsWorkspace: true },
        { cli: 'code', name: 'VS Code', newWindowFlag: '--new-window', supportsWorkspace: true },
      ],
      promptForEditor: async () => 'code',
      spawnEditor: makeSpawnEditor(spawned),
    })({
      cwd: repoRoot,
      stderr: () => undefined,
      stdout: () => undefined,
    });

    expect(result).toBe(0);
    expect(spawned[0].cli).toBe('code');
  });

  it('generates a .code-workspace file when --workspace is passed', async () => {
    const repoRoot = await createRepository();
    const spawned: { cli: string; args: string[] }[] = [];
    const workspacePath = join(repoRoot, 'gji-test-repo.code-workspace');

    const result = await createOpenCommand({ spawnEditor: makeSpawnEditor(spawned) })({
      cwd: repoRoot,
      editor: 'code',
      stderr: () => undefined,
      stdout: () => undefined,
      workspace: true,
    });

    expect(result).toBe(0);
    await expect(pathExists(workspacePath)).resolves.toBe(true);
    const contents = JSON.parse(await readFile(workspacePath, 'utf8')) as unknown;
    expect(contents).toMatchObject({ folders: [{ path: '.' }] });
    expect(spawned[0].args).toContain(workspacePath);
  });

  it('does not overwrite an existing .code-workspace file', async () => {
    const repoRoot = await createRepository();
    const workspacePath = join(repoRoot, 'gji-test-repo.code-workspace');
    const original = JSON.stringify({ folders: [{ path: '.' }], settings: { custom: true } });

    await import('node:fs/promises').then((fs) => fs.writeFile(workspacePath, original, 'utf8'));

    await createOpenCommand({ spawnEditor: makeSpawnEditor([]) })({
      cwd: repoRoot,
      editor: 'code',
      stderr: () => undefined,
      stdout: () => undefined,
      workspace: true,
    });

    expect(await readFile(workspacePath, 'utf8')).toBe(original);
  });

  it('exits 1 and reports error when spawn fails', async () => {
    const repoRoot = await createRepository();
    const stderr: string[] = [];

    const result = await createOpenCommand({
      spawnEditor: async () => { throw new Error('ENOENT: code not found'); },
    })({
      cwd: repoRoot,
      editor: 'code',
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    expect(result).toBe(1);
    expect(stderr.join('')).toContain('failed to launch editor');
  });
});
