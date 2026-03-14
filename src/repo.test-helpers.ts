import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gji-repo-'));
  const repoRoot = join(root, 'gji-test-repo');

  await mkdir(repoRoot, { recursive: true });
  await writeFile(join(repoRoot, 'README.md'), '# temp repo\n', 'utf8');
  await runGit(repoRoot, ['init']);
  await runGit(repoRoot, ['config', 'user.name', 'Codex']);
  await runGit(repoRoot, ['config', 'user.email', 'codex@example.com']);
  await runGit(repoRoot, ['add', 'README.md']);
  await runGit(repoRoot, ['commit', '-m', 'init']);

  return realpath(repoRoot);
}

export async function createRepositoryWithOrigin(): Promise<{
  originRoot: string;
  repoRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'gji-remote-'));
  const originRoot = join(root, 'origin.git');
  const repoRoot = await createRepository();

  await runGit(root, ['init', '--bare', originRoot]);
  await runGit(repoRoot, ['remote', 'add', 'origin', originRoot]);
  await runGit(repoRoot, ['push', '-u', 'origin', 'HEAD']);

  return {
    originRoot,
    repoRoot,
  };
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}
