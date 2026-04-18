import { describe, expect, it } from 'vitest';

import { readWorktreeHealth } from './git.js';
import {
  addLinkedWorktree,
  cloneRepository,
  createRepositoryWithOrigin,
  runGit,
} from './repo.test-helpers.js';

describe('readWorktreeHealth', () => {
  it('reports upstreamGone: false when branch is up to date with upstream', async () => {
    // Given a repo with a branch pushed and tracked.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branch = 'feature/tracked';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    await runGit(repoRoot, ['push', '-u', 'origin', branch]);

    // When reading health of that worktree.
    const health = await readWorktreeHealth(worktreePath);

    // Then upstreamGone is false because the upstream exists.
    expect(health.hasUpstream).toBe(true);
    expect(health.upstreamGone).toBe(false);
  });

  it('reports upstreamGone: false when no upstream is configured', async () => {
    // Given a fresh repo with no upstream configured.
    const { repoRoot } = await createRepositoryWithOrigin();
    const branch = 'feature/no-upstream';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);

    // When reading health of the untracked worktree.
    const health = await readWorktreeHealth(worktreePath);

    // Then upstreamGone is false because there is no upstream at all.
    expect(health.hasUpstream).toBe(false);
    expect(health.upstreamGone).toBe(false);
  });

  it('reports upstreamGone: true when the remote branch has been deleted and pruned', async () => {
    // Given a repo with a branch pushed, tracked, then the remote branch deleted.
    const { originRoot, repoRoot } = await createRepositoryWithOrigin();
    const branch = 'feature/gone-upstream';
    const worktreePath = await addLinkedWorktree(repoRoot, branch);
    await runGit(repoRoot, ['push', '-u', 'origin', branch]);

    // Delete the remote branch and prune the local tracking ref.
    const upstreamClone = await cloneRepository(originRoot);
    await runGit(upstreamClone, ['push', 'origin', '--delete', branch]);
    await runGit(repoRoot, ['fetch', '--prune', 'origin']);

    // When reading health of the worktree whose upstream is now gone.
    const health = await readWorktreeHealth(worktreePath);

    // Then upstreamGone is true because the upstream ref no longer exists.
    expect(health.hasUpstream).toBe(true);
    expect(health.upstreamGone).toBe(true);
    expect(health.ahead).toBe(0);
    expect(health.behind).toBe(0);
  });
});
