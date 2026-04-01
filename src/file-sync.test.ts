import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { syncFiles } from './file-sync.js';

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'gji-file-sync-'));
}

describe('syncFiles', () => {
  it('copies a file from mainRoot to targetPath', async () => {
    // Given
    const mainRoot = await makeTmpDir();
    const targetPath = await makeTmpDir();
    await writeFile(join(mainRoot, 'foo.txt'), 'hello', 'utf8');

    // When
    await syncFiles(mainRoot, targetPath, ['foo.txt']);

    // Then
    const content = await readFile(join(targetPath, 'foo.txt'), 'utf8');
    expect(content).toBe('hello');
  });

  it('skips silently when the source does not exist', async () => {
    // Given
    const mainRoot = await makeTmpDir();
    const targetPath = await makeTmpDir();

    // When
    await syncFiles(mainRoot, targetPath, ['missing.txt']);

    // Then — no target file was created
    await expect(stat(join(targetPath, 'missing.txt'))).rejects.toThrow();
  });

  it('skips silently when the target already exists', async () => {
    // Given
    const mainRoot = await makeTmpDir();
    const targetPath = await makeTmpDir();
    await writeFile(join(mainRoot, 'foo.txt'), 'new content', 'utf8');
    await writeFile(join(targetPath, 'foo.txt'), 'original content', 'utf8');

    // When
    await syncFiles(mainRoot, targetPath, ['foo.txt']);

    // Then — existing file is untouched
    const content = await readFile(join(targetPath, 'foo.txt'), 'utf8');
    expect(content).toBe('original content');
  });

  it('copies a file into a nested path, creating parent directories', async () => {
    // Given
    const mainRoot = await makeTmpDir();
    const targetPath = await makeTmpDir();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(mainRoot, 'a/b'), { recursive: true });
    await writeFile(join(mainRoot, 'a/b/config.json'), '{}', 'utf8');

    // When
    await syncFiles(mainRoot, targetPath, ['a/b/config.json']);

    // Then
    const content = await readFile(join(targetPath, 'a/b/config.json'), 'utf8');
    expect(content).toBe('{}');
  });

  it('rejects an absolute-path pattern', async () => {
    // Given
    const mainRoot = await makeTmpDir();
    const targetPath = await makeTmpDir();

    // When / Then
    await expect(syncFiles(mainRoot, targetPath, ['/etc/passwd'])).rejects.toThrow(
      'pattern must be a relative path',
    );
  });

  it('rejects a pattern containing ".." segments', async () => {
    // Given
    const mainRoot = await makeTmpDir();
    const targetPath = await makeTmpDir();

    // When / Then
    await expect(syncFiles(mainRoot, targetPath, ['../secret.txt'])).rejects.toThrow(
      "pattern must not contain '..' segments",
    );
  });

  it('copies a gitignored file that exists only in the main worktree', async() => {
    // Given — a .gitignore that excludes .env, and a .env file present at the source.
    // This is the primary use case: syncing secrets/credentials that git won't carry
    // into a fresh worktree.
    const mainRoot = await makeTmpDir();
    const targetPath = await makeTmpDir();
    await writeFile(join(mainRoot, '.gitignore'), '.env\n', 'utf8');
    await writeFile(join(mainRoot, '.env'), 'SECRET=abc\n', 'utf8');

    // When
    await syncFiles(mainRoot, targetPath, ['.env']);

    // Then — the ignored file is copied regardless of .gitignore
    const content = await readFile(join(targetPath, '.env'), 'utf8');
    expect(content).toBe('SECRET=abc\n');
  });

  it('handles an empty patterns array without error', async () => {
    // Given
    const mainRoot = await makeTmpDir();
    const targetPath = await makeTmpDir();

    // When / Then
    await expect(syncFiles(mainRoot, targetPath, [])).resolves.toBeUndefined();
  });
});
