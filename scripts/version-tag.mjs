import { execFile as execFileCallback } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const CI_TAG_MESSAGE = 'Created by CI for automated publish retry support';

async function main() {
  const version = await readPackageVersion();
  const tag = resolveVersionTag(version);
  const before = process.env.GITHUB_EVENT_BEFORE ?? '';
  const sha = process.env.GITHUB_SHA;
  const ref = process.env.GITHUB_REF;

  if (!sha || !ref) {
    throw new Error('GITHUB_SHA and GITHUB_REF must be set');
  }

  const [previousVersion, tagMetadata] = await Promise.all([
    readPackageVersionAtRef(before),
    readTagMetadata(tag),
  ]);
  const decision = shouldCreateVersionTag({
    currentVersion: version,
    isCiTag: tagMetadata.isCiTag,
    previousVersion,
    ref,
    tagExists: tagMetadata.exists,
    tagPointsAtHead: tagMetadata.pointsAtHead,
  });
  const outputs = {
    created: 'false',
    decision: decision.reason,
    publish: decision.publish ? 'true' : 'false',
    ref: sha,
    tag,
    version,
  };

  console.log(`version=${version}`);
  console.log(`previous_version=${previousVersion ?? ''}`);
  console.log(`tag=${tag}`);
  console.log(`decision=${decision.reason}`);

  if (!decision.create) {
    await writeOutputs(outputs);
    return;
  }

  await runGit(['tag', '-a', tag, '-m', CI_TAG_MESSAGE, sha]);
  await runGit(['push', 'origin', tag]);
  outputs.created = 'true';
  await writeOutputs(outputs);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

/**
 * Normalize a package version into the git tag format used by release automation.
 *
 * @param {string} version
 * @returns {string}
 */
export function resolveVersionTag(version) {
  return `v${version}`;
}

/**
 * Decide whether CI should create a version tag and/or invoke publish for the current commit.
 *
 * CI-created tags on the current commit stay publishable so reruns can recover from a failed
 * publish, while existing non-CI tags are treated as already handled.
 *
 * @param {object} params
 * @param {string} params.currentVersion
 * @param {boolean} [params.isCiTag=false]
 * @param {string | null} params.previousVersion
 * @param {string} params.ref
 * @param {boolean} params.tagExists
 * @param {boolean} [params.tagPointsAtHead=false]
 * @returns {{ create: boolean, publish: boolean, reason: string }}
 */
export function shouldCreateVersionTag({
  currentVersion,
  isCiTag = false,
  previousVersion,
  ref,
  tagExists,
  tagPointsAtHead = false,
}) {
  if (ref !== 'refs/heads/main') {
    return {
      create: false,
      publish: false,
      reason: 'non-main-branch',
    };
  }

  if (currentVersion === previousVersion) {
    return {
      create: false,
      publish: false,
      reason: 'version-unchanged',
    };
  }

  if (!tagExists) {
    return {
      create: true,
      publish: true,
      reason: 'version-bump',
    };
  }

  if (isCiTag && tagPointsAtHead) {
    return {
      create: false,
      publish: true,
      reason: 'retry-publish',
    };
  }

  return {
    create: false,
    publish: false,
    reason: 'tag-exists',
  };
}

async function readPackageVersion() {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json is missing a valid version string');
  }

  return packageJson.version;
}

async function readPackageVersionAtRef(ref) {
  if (isZeroSha(ref)) {
    return null;
  }

  try {
    const packageJsonText = await runGit(['show', `${ref}:package.json`]);
    const packageJson = JSON.parse(packageJsonText);

    return typeof packageJson.version === 'string' && packageJson.version.length > 0
      ? packageJson.version
      : null;
  } catch {
    return null;
  }
}

async function readTagMetadata(tag) {
  if (!tag) {
    return {
      exists: false,
      isCiTag: false,
      pointsAtHead: false,
    };
  }

  try {
    const [message, sha] = await Promise.all([
      runGit(['for-each-ref', `refs/tags/${tag}`, '--format=%(contents)']),
      runGit(['rev-list', '-n', '1', tag]),
    ]);

    return {
      exists: true,
      isCiTag: message === CI_TAG_MESSAGE,
      pointsAtHead: sha === process.env.GITHUB_SHA,
    };
  } catch {
    return {
      exists: false,
      isCiTag: false,
      pointsAtHead: false,
    };
  }
}

async function writeOutputs(outputs) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  const body = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  await appendFile(process.env.GITHUB_OUTPUT, `${body}\n`);
}

async function runGit(args) {
  const { stdout } = await execFile('git', args);
  return stdout.trim();
}

function isZeroSha(value) {
  return !value || /^0+$/.test(value);
}
