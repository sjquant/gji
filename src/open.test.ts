import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createOpenCommand } from './open.js';
import { addLinkedWorktree, createRepository, pathExists } from './repo.test-helpers.js';

beforeEach(async () => {
  // Isolate global config so tests don't read from or write to ~/.config/gji.
  process.env.GJI_CONFIG_DIR = await mkdtemp(join(tmpdir(), 'gji-config-'));
});

afterEach(() => {
  delete process.env.GJI_CONFIG_DIR;
  delete process.env.GJI_NO_TUI;
});

describe('gji open', () => {
  it('prompts for a worktree when no branch is given and opens the selection', async () => {
    // Given a repository with a linked worktree.
    const repoRoot = await createRepository();
    const branch = 'feature/open-select';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    const spawned: { cli: string; args: string[] }[] = [];
    let capturedBranches: string[] = [];
    const runOpenCommand = createOpenCommand({
      promptForWorktree: async (worktrees) => {
        capturedBranches = worktrees.map((w) => w.branch ?? '(detached)');
        return worktreePath;
      },
      spawnEditor: async (cli, args) => { spawned.push({ cli, args }); },
    });

    // When gji open runs with no branch argument.
    const result = await runOpenCommand({
      cwd: repoRoot,
      editor: 'code',
      stderr: () => undefined,
      stdout: () => undefined,
    });

    // Then it prompts for a worktree and opens the selection.
    expect(result).toBe(0);
    expect(capturedBranches).toContain(branch);
    expect(spawned[0].args).toContain(worktreePath);
  });

  it('places the current worktree first in the selector', async () => {
    // Given a repository with two linked worktrees, running from inside worktreeA.
    const repoRoot = await createRepository();
    const branchA = 'feature/order-a';
    const branchB = 'feature/order-b';
    const worktreeA = await addLinkedWorktree(repoRoot, branchA);
    await addLinkedWorktree(repoRoot, branchB);
    let capturedFirst: { branch: string | null; isCurrent: boolean } | undefined;
    const runOpenCommand = createOpenCommand({
      promptForWorktree: async (worktrees) => {
        capturedFirst = { branch: worktrees[0].branch, isCurrent: worktrees[0].isCurrent };
        return worktreeA;
      },
      spawnEditor: async () => undefined,
    });

    // When gji open runs interactively from inside worktreeA.
    await runOpenCommand({
      cwd: worktreeA,
      editor: 'code',
      stderr: () => undefined,
      stdout: () => undefined,
    });

    // Then the current worktree appears first with isCurrent: true.
    expect(capturedFirst).toEqual({ branch: branchA, isCurrent: true });
  });

  it('aborts when the worktree prompt is cancelled', async () => {
    // Given a repository and a cancelled worktree prompt.
    const repoRoot = await createRepository();
    const stderr: string[] = [];
    const runOpenCommand = createOpenCommand({
      promptForWorktree: async () => null,
      spawnEditor: async () => { throw new Error('spawn must not be called after abort'); },
    });

    // When gji open runs and the prompt is cancelled.
    const result = await runOpenCommand({
      cwd: repoRoot,
      editor: 'code',
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    // Then it exits 1 and reports the abort.
    expect(result).toBe(1);
    expect(stderr.join('')).toContain('Aborted');
  });

  it('opens a linked worktree by branch name without prompting', async () => {
    // Given a repository with a linked worktree for a specific branch.
    const repoRoot = await createRepository();
    const branch = 'feature/open-test';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    const spawned: { cli: string; args: string[] }[] = [];
    const runOpenCommand = createOpenCommand({
      promptForWorktree: async () => { throw new Error('prompt must not be called when branch is given'); },
      spawnEditor: async (cli, args) => { spawned.push({ cli, args }); },
    });

    // When gji open runs with a branch argument.
    const result = await runOpenCommand({
      branch,
      cwd: repoRoot,
      editor: 'cursor',
      stderr: () => undefined,
      stdout: () => undefined,
    });

    // Then it opens the matching worktree without prompting.
    expect(result).toBe(0);
    expect(spawned[0].args).toContain(worktreePath);
  });

  it('opens the current worktree in the specified editor', async () => {
    // Given a repository root and VS Code as the editor.
    const repoRoot = await createRepository();
    const spawned: { cli: string; args: string[] }[] = [];
    const stdout: string[] = [];
    const runOpenCommand = createOpenCommand({
      promptForWorktree: async (worktrees) => worktrees.find((w) => w.isCurrent)?.path ?? null,
      spawnEditor: async (cli, args) => { spawned.push({ cli, args }); },
    });

    // When gji open runs with --editor code.
    const result = await runOpenCommand({
      cwd: repoRoot,
      editor: 'code',
      stderr: () => undefined,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it spawns VS Code with --new-window on the repo path.
    expect(result).toBe(0);
    expect(spawned[0].cli).toBe('code');
    expect(spawned[0].args).toContain('--new-window');
    expect(spawned[0].args).toContain(repoRoot);
    expect(stdout.join('')).toContain('VS Code');
  });

  it('exits 1 when the requested branch has no worktree', async () => {
    // Given a repository with no worktree for the requested branch.
    const repoRoot = await createRepository();
    const stderr: string[] = [];
    const runOpenCommand = createOpenCommand({
      spawnEditor: async () => { throw new Error('spawn must not be called when branch is not found'); },
    });

    // When gji open runs with an unknown branch name.
    const result = await runOpenCommand({
      branch: 'nonexistent',
      cwd: repoRoot,
      editor: 'code',
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    // Then it exits 1 and emits a Hint: line pointing to gji ls.
    expect(result).toBe(1);
    expect(stderr.join('')).toContain('nonexistent');
    expect(stderr.join('')).toContain('gji ls');
  });

  it('exits 1 when no editor is detected or configured', async () => {
    // Given no supported editors are installed and no editor is configured.
    const repoRoot = await createRepository();
    const stderr: string[] = [];
    const runOpenCommand = createOpenCommand({
      detectEditors: async () => [],
      promptForWorktree: async (worktrees) => worktrees[0]?.path ?? null,
      spawnEditor: async () => { throw new Error('spawn must not be called when no editor is found'); },
    });

    // When gji open runs without --editor.
    const result = await runOpenCommand({
      cwd: repoRoot,
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    // Then it exits 1 with an actionable error message.
    expect(result).toBe(1);
    expect(stderr.join('')).toContain('no supported editor detected');
  });

  it('auto-selects the only detected editor without prompting', async () => {
    // Given exactly one editor is installed and no editor is configured.
    const repoRoot = await createRepository();
    const spawned: { cli: string; args: string[] }[] = [];
    const runOpenCommand = createOpenCommand({
      detectEditors: async () => [{ cli: 'zed', name: 'Zed', supportsWorkspace: false }],
      promptForEditor: async () => { throw new Error('editor prompt must not be called with one editor'); },
      promptForWorktree: async (worktrees) => worktrees[0]?.path ?? null,
      spawnEditor: async (cli, args) => { spawned.push({ cli, args }); },
    });

    // When gji open runs without --editor.
    const result = await runOpenCommand({
      cwd: repoRoot,
      stderr: () => undefined,
      stdout: () => undefined,
    });

    // Then it uses the only detected editor without showing a prompt.
    expect(result).toBe(0);
    expect(spawned[0].cli).toBe('zed');
  });

  it('prompts when multiple editors are detected and uses the selection', async () => {
    // Given two editors are installed and no editor is configured.
    const repoRoot = await createRepository();
    const spawned: { cli: string; args: string[] }[] = [];
    const runOpenCommand = createOpenCommand({
      detectEditors: async () => [
        { cli: 'cursor', name: 'Cursor', newWindowFlag: '--new-window', supportsWorkspace: true },
        { cli: 'code', name: 'VS Code', newWindowFlag: '--new-window', supportsWorkspace: true },
      ],
      promptForEditor: async () => 'code',
      promptForWorktree: async (worktrees) => worktrees[0]?.path ?? null,
      spawnEditor: async (cli, args) => { spawned.push({ cli, args }); },
    });

    // When gji open runs without --editor and the user picks VS Code.
    const result = await runOpenCommand({
      cwd: repoRoot,
      stderr: () => undefined,
      stdout: () => undefined,
    });

    // Then it opens in VS Code.
    expect(result).toBe(0);
    expect(spawned[0].cli).toBe('code');
  });

  it('generates a .code-workspace file when --workspace is passed', async () => {
    // Given a repository and VS Code as the editor.
    const repoRoot = await createRepository();
    const workspacePath = join(repoRoot, 'gji-test-repo.code-workspace');
    const spawned: { cli: string; args: string[] }[] = [];
    const runOpenCommand = createOpenCommand({
      promptForWorktree: async (worktrees) => worktrees.find((w) => w.isCurrent)?.path ?? null,
      spawnEditor: async (cli, args) => { spawned.push({ cli, args }); },
    });

    // When gji open runs with --workspace.
    const result = await runOpenCommand({
      cwd: repoRoot,
      editor: 'code',
      stderr: () => undefined,
      stdout: () => undefined,
      workspace: true,
    });

    // Then it creates a .code-workspace file and opens it.
    expect(result).toBe(0);
    await expect(pathExists(workspacePath)).resolves.toBe(true);
    const contents = JSON.parse(await readFile(workspacePath, 'utf8')) as unknown;
    expect(contents).toMatchObject({ folders: [{ path: '.' }] });
    expect(spawned[0].args).toContain(workspacePath);
  });

  it('does not overwrite an existing .code-workspace file', async () => {
    // Given a .code-workspace file already exists with custom settings.
    const repoRoot = await createRepository();
    const workspacePath = join(repoRoot, 'gji-test-repo.code-workspace');
    const original = JSON.stringify({ folders: [{ path: '.' }], settings: { custom: true } });
    await writeFile(workspacePath, original, 'utf8');
    const runOpenCommand = createOpenCommand({
      promptForWorktree: async (worktrees) => worktrees.find((w) => w.isCurrent)?.path ?? null,
      spawnEditor: async () => undefined,
    });

    // When gji open runs with --workspace.
    await runOpenCommand({
      cwd: repoRoot,
      editor: 'code',
      stderr: () => undefined,
      stdout: () => undefined,
      workspace: true,
    });

    // Then the existing file is left unchanged.
    expect(await readFile(workspacePath, 'utf8')).toBe(original);
  });

  it('exits 1 and reports error when spawning the editor fails', async () => {
    // Given the editor process fails to launch.
    const repoRoot = await createRepository();
    const stderr: string[] = [];
    const runOpenCommand = createOpenCommand({
      promptForWorktree: async (worktrees) => worktrees[0]?.path ?? null,
      spawnEditor: async () => { throw new Error('ENOENT: code not found'); },
    });

    // When gji open runs.
    const result = await runOpenCommand({
      cwd: repoRoot,
      editor: 'code',
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
    });

    // Then it exits 1 and reports the failure.
    expect(result).toBe(1);
    expect(stderr.join('')).toContain('failed to launch editor');
  });

  it('saves the editor to global config when --save is passed', async () => {
    // Given a repository and Cursor as the chosen editor.
    const repoRoot = await createRepository();
    const stdout: string[] = [];
    const runOpenCommand = createOpenCommand({
      promptForWorktree: async (worktrees) => worktrees[0]?.path ?? null,
      spawnEditor: async () => undefined,
    });

    // When gji open runs with --save.
    const result = await runOpenCommand({
      cwd: repoRoot,
      editor: 'cursor',
      save: true,
      stderr: () => undefined,
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then it confirms the save in stdout.
    expect(result).toBe(0);
    expect(stdout.join('')).toContain('Saved editor');
    expect(stdout.join('')).toContain('Cursor');
  });

  it('falls back to the current worktree in headless mode without prompting', async () => {
    // Given GJI_NO_TUI=1 is set and the cwd is the main repo root.
    process.env.GJI_NO_TUI = '1';
    const repoRoot = await createRepository();
    await addLinkedWorktree(repoRoot, 'feature/headless-open');
    const spawned: { cli: string; args: string[] }[] = [];
    const runOpenCommand = createOpenCommand({
      promptForWorktree: async () => { throw new Error('prompt must not be called in headless mode'); },
      spawnEditor: async (cli, args) => { spawned.push({ cli, args }); },
    });

    // When gji open runs in headless mode without a branch argument.
    const result = await runOpenCommand({
      cwd: repoRoot,
      editor: 'code',
      stderr: () => undefined,
      stdout: () => undefined,
    });

    // Then it opens the current worktree without prompting.
    expect(result).toBe(0);
    expect(spawned[0].args).toContain(repoRoot);
  });

  it('warns and ignores --workspace for editors that do not support it', async () => {
    // Given Zed as the editor, which does not support .code-workspace files.
    const repoRoot = await createRepository();
    const spawned: { cli: string; args: string[] }[] = [];
    const stderr: string[] = [];
    const runOpenCommand = createOpenCommand({
      promptForWorktree: async (worktrees) => worktrees.find((w) => w.isCurrent)?.path ?? null,
      spawnEditor: async (cli, args) => { spawned.push({ cli, args }); },
    });

    // When gji open runs with --workspace --editor zed.
    const result = await runOpenCommand({
      cwd: repoRoot,
      editor: 'zed',
      stderr: (chunk) => stderr.push(chunk),
      stdout: () => undefined,
      workspace: true,
    });

    // Then it warns about --workspace being unsupported and opens the path directly.
    expect(result).toBe(0);
    expect(stderr.join('')).toContain('--workspace is not supported for Zed');
    expect(spawned[0].args).toContain(repoRoot);
  });
});
