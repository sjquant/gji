import { describe, expect, it } from 'vitest';

import { resolveVersionTag, shouldCreateVersionTag } from './version-tag.mjs';

describe('resolveVersionTag', () => {
  it('prefixes package versions with v', () => {
    expect(resolveVersionTag('0.1.0-beta.9')).toBe('v0.1.0-beta.9');
  });
});

describe('shouldCreateVersionTag', () => {
  it('creates a tag for a package.json version bump on main', () => {
    expect(
      shouldCreateVersionTag({
        currentVersion: '0.1.0-beta.10',
        previousVersion: '0.1.0-beta.9',
        ref: 'refs/heads/main',
        tagExists: false,
      }),
    ).toEqual({
      create: true,
      publish: true,
      reason: 'version-bump',
    });
  });

  it('skips tag creation when the version did not change and the tag already exists', () => {
    expect(
      shouldCreateVersionTag({
        currentVersion: '0.1.0-beta.9',
        previousVersion: '0.1.0-beta.9',
        ref: 'refs/heads/main',
        tagExists: true,
      }),
    ).toEqual({
      create: false,
      publish: false,
      reason: 'version-unchanged',
    });
  });

  it('creates a tag when the current package version is still untagged', () => {
    expect(
      shouldCreateVersionTag({
        currentVersion: '0.2.0',
        previousVersion: '0.2.0',
        ref: 'refs/heads/main',
        tagExists: false,
      }),
    ).toEqual({
      create: true,
      publish: true,
      reason: 'missing-version-tag',
    });
  });

  it('skips tag creation and publish when a non-CI version tag already exists', () => {
    expect(
      shouldCreateVersionTag({
        currentVersion: '0.1.0-beta.10',
        previousVersion: '0.1.0-beta.9',
        ref: 'refs/heads/main',
        isCiTag: false,
        tagPointsAtHead: true,
        tagExists: true,
      }),
    ).toEqual({
      create: false,
      publish: false,
      reason: 'tag-exists',
    });
  });

  it('skips tag creation outside main', () => {
    expect(
      shouldCreateVersionTag({
        currentVersion: '0.1.0-beta.10',
        previousVersion: '0.1.0-beta.9',
        ref: 'refs/heads/feature/test',
        tagExists: false,
      }),
    ).toEqual({
      create: false,
      publish: false,
      reason: 'non-main-branch',
    });
  });

  it('creates a tag when package.json is first introduced on main', () => {
    expect(
      shouldCreateVersionTag({
        currentVersion: '0.1.0',
        previousVersion: null,
        ref: 'refs/heads/main',
        tagExists: false,
      }),
    ).toEqual({
      create: true,
      publish: true,
      reason: 'version-bump',
    });
  });

  it('retries publish for an existing CI-created tag on the same commit', () => {
    expect(
      shouldCreateVersionTag({
        currentVersion: '0.1.0-beta.10',
        previousVersion: '0.1.0-beta.9',
        ref: 'refs/heads/main',
        isCiTag: true,
        tagPointsAtHead: true,
        tagExists: true,
      }),
    ).toEqual({
      create: false,
      publish: true,
      reason: 'retry-publish',
    });
  });
});
