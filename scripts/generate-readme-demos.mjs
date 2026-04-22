import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT_DIR = join(REPO_ROOT, '.github', 'assets');
const WORK_DIR = mkdtempSync(join(tmpdir(), 'gji-readme-demos-'));
const PROMPT_USER = 'sjquant@gji';
const PROMPT_CWD = '~/code/gji';
const GREEN = '\u001b[32m';
const BLUE = '\u001b[34m';
const RESET = '\u001b[39m';
const CAPTURE_SCALE = 2;
const SVG_TERM_CLI_PACKAGE = 'svg-term-cli@2.1.1';
const PLAYWRIGHT_PACKAGE = 'playwright@1.59.1';

await main();

async function main() {
  try {
    assertSupportedEnvironment();
    mkdirSync(OUTPUT_DIR, { recursive: true });

    for (const demo of buildDemos()) {
      generateDemo(demo);
    }
  } finally {
    rmSync(WORK_DIR, { recursive: true, force: true });
  }
}

function assertSupportedEnvironment() {
  if (process.platform !== 'darwin') {
    throw new Error('generate:readme-demos currently supports macOS only.');
  }

  assertAvailable('asciinema');
  assertAvailable('ffmpeg');
  assertAvailable('zsh');
  assertChromeAvailable();
}

function assertChromeAvailable() {
  const result = spawnSync('open', ['-Ra', 'Google Chrome'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    throw new Error('Google Chrome is required for generate:readme-demos.');
  }
}

function generateDemo(demo) {
  const demoDir = join(WORK_DIR, demo.id);
  mkdirSync(demoDir, { recursive: true });

  const scriptPath = join(demoDir, `${demo.id}.sh`);
  const castV3Path = join(OUTPUT_DIR, `readme-${demo.id}.cast`);
  const castV2Path = join(demoDir, `${demo.id}-v2.cast`);
  const frameSvgDir = join(demoDir, 'frame-svgs');
  const framesDir = join(demoDir, 'frames');
  const concatPath = join(demoDir, `${demo.id}.concat.txt`);
  const gifPath = join(OUTPUT_DIR, `readme-${demo.id}.gif`);

  mkdirSync(frameSvgDir, { recursive: true });
  mkdirSync(framesDir, { recursive: true });
  writeFileSync(scriptPath, renderShellScript(demo.steps), { mode: 0o755 });

  run('asciinema', ['rec', '--quiet', '--overwrite', '-c', scriptPath, castV3Path]);
  run('asciinema', ['convert', '-f', 'asciicast-v2', '--overwrite', castV3Path, castV2Path]);

  const capturePlan = readCapturePlan(castV3Path);
  const firstFrameSvgPath = renderFrameSvg(castV2Path, frameSvgDir, demo, 0, capturePlan.frameCaptureTimesMs[0]);
  const viewport = readSvgViewport(firstFrameSvgPath);
  const framePaths = captureFrames(
    castV2Path,
    frameSvgDir,
    framesDir,
    viewport,
    capturePlan.frameCaptureTimesMs,
    demo,
  );
  writeFileSync(concatPath, renderConcatManifest(framePaths, capturePlan.frameDurationsS));

  run('ffmpeg', [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatPath,
    '-vf',
    'fps=10,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
    '-loop',
    '0',
    gifPath,
  ]);
}

function buildDemos() {
  return [
    {
      id: 'before',
      cols: 70,
      rows: 12,
      steps: [
        { text: prompt('git stash push -m "wip"'), pauseAfterSeconds: 0.55 },
        { text: 'Saved working directory and index state On main: wip', pauseAfterSeconds: 0.5 },
        { text: prompt('git switch teammate/review-1234'), pauseAfterSeconds: 0.55 },
        { text: "Switched to branch 'teammate/review-1234'", pauseAfterSeconds: 0.5 },
        { text: prompt('npm install'), pauseAfterSeconds: 0.55 },
        { text: 'added 412 packages, and audited 413 packages in 4s', pauseAfterSeconds: 0.45 },
        { text: 'found 0 vulnerabilities', pauseAfterSeconds: 0.55 },
        { text: prompt('git switch -'), pauseAfterSeconds: 0.55 },
        { text: "Switched to branch 'main'", pauseAfterSeconds: 0.5 },
        { text: prompt('git stash pop'), pauseAfterSeconds: 0.55 },
        { text: 'Auto-merging package.json', pauseAfterSeconds: 0.45 },
        { text: 'CONFLICT (content): Merge conflict in package.json', pauseAfterSeconds: 1.2 },
      ],
    },
    {
      id: 'after',
      cols: 70,
      rows: 12,
      steps: [
        { text: prompt('gji pr 1234'), pauseAfterSeconds: 0.6 },
        { text: 'added 412 packages, and audited 413 packages in 4s', pauseAfterSeconds: 0.45 },
        { text: 'found 0 vulnerabilities', pauseAfterSeconds: 0.55 },
        { text: '~/code/worktrees/gji/pr-1234', pauseAfterSeconds: 0.5 },
        { text: prompt('pwd', '~/code/worktrees/gji/pr-1234'), pauseAfterSeconds: 0.45 },
        { text: '/Users/me/code/worktrees/gji/pr-1234', pauseAfterSeconds: 0.5 },
        { text: prompt('gji ls', '~/code/worktrees/gji/pr-1234'), pauseAfterSeconds: 0.5 },
        { text: 'main      ~/code/gji', pauseAfterSeconds: 0.35 },
        { text: 'pr-1234   ~/code/worktrees/gji/pr-1234', pauseAfterSeconds: 1.3 },
      ],
    },
  ];
}

function prompt(command, cwd = PROMPT_CWD) {
  return `${GREEN}${PROMPT_USER}${RESET} ${BLUE}${cwd}${RESET} $ ${command}`;
}

function renderShellScript(steps) {
  const lines = [
    '#!/bin/zsh',
    'set -euo pipefail',
  ];

  for (const step of steps) {
    lines.push(`printf '%s\\r\\n' '${escapeForSingleQuotes(step.text)}'`);
    lines.push(`sleep ${step.pauseAfterSeconds}`);
  }

  return `${lines.join('\n')}\n`;
}

function readCapturePlan(castPath) {
  const lines = readFileSync(castPath, 'utf8').trim().split('\n');
  let elapsedSeconds = 0;
  let totalSeconds = 0;
  const outputTimes = [];

  for (const rawLine of lines.slice(1)) {
    const [deltaSeconds, kind] = JSON.parse(rawLine);
    elapsedSeconds += deltaSeconds;
    totalSeconds = elapsedSeconds;

    if (kind === 'o') {
      outputTimes.push(elapsedSeconds);
    }
  }

  const frameDurationsS = outputTimes.map((timeSeconds, index) => {
    const nextTimeSeconds = outputTimes[index + 1] ?? totalSeconds;
    return Number((nextTimeSeconds - timeSeconds).toFixed(3));
  });
  const frameCaptureTimesMs = outputTimes.map((timeSeconds, index) => {
    const nextTimeSeconds = outputTimes[index + 1] ?? totalSeconds;
    return Math.ceil((((timeSeconds + nextTimeSeconds) / 2) * 1000));
  });

  return { frameCaptureTimesMs, frameDurationsS };
}

function readSvgViewport(svgPath) {
  const svg = readFileSync(svgPath, 'utf8');
  const match = svg.match(/<svg[^>]*width="([0-9.]+)"[^>]*height="([0-9.]+)"/);

  if (!match) {
    throw new Error(`Unable to read viewport from ${svgPath}`);
  }

  return {
    width: Math.ceil(Number(match[1])),
    height: Math.ceil(Number(match[2])),
  };
}

function renderFrameSvg(castV2Path, frameSvgDir, demo, index, captureTimeMs) {
  const frameSvgPath = join(frameSvgDir, `frame-${String(index).padStart(3, '0')}.svg`);

  run('npx', [
    '-y',
    SVG_TERM_CLI_PACKAGE,
    '--in',
    castV2Path,
    '--out',
    frameSvgPath,
    '--width',
    String(demo.cols),
    '--height',
    String(demo.rows),
    '--window',
    '--no-cursor',
    '--at',
    String(captureTimeMs),
  ]);

  return frameSvgPath;
}

function captureFrames(castV2Path, frameSvgDir, framesDir, viewport, frameCaptureTimesMs, demo) {
  const framePaths = [];
  const scaledViewport = {
    width: viewport.width * CAPTURE_SCALE,
    height: viewport.height * CAPTURE_SCALE,
  };

  for (const [index, frameCaptureTimeMs] of frameCaptureTimesMs.entries()) {
    const framePath = join(framesDir, `frame-${String(index).padStart(3, '0')}.png`);
    const frameSvgPath = renderFrameSvg(castV2Path, frameSvgDir, demo, index, frameCaptureTimeMs);
    const frameHtmlPath = renderFramePage(frameSvgDir, frameSvgPath, scaledViewport);

    run('npx', [
      '-y',
      PLAYWRIGHT_PACKAGE,
      'screenshot',
      '--channel=chrome',
      `--viewport-size=${scaledViewport.width},${scaledViewport.height}`,
      `file://${frameHtmlPath}`,
      framePath,
    ]);
    framePaths.push(framePath);
  }

  return framePaths;
}

function renderFramePage(frameSvgDir, frameSvgPath, scaledViewport) {
  const frameHtmlPath = join(frameSvgDir, `${basename(frameSvgPath, '.svg')}.html`);
  const frameSvgUrl = pathToFileURL(frameSvgPath).href;

  writeFileSync(frameHtmlPath, `<!doctype html>
<html>
  <body style="margin:0;background:#282d35;overflow:hidden;">
    <img src="${frameSvgUrl}" width="${scaledViewport.width}" height="${scaledViewport.height}" style="display:block;width:${scaledViewport.width}px;height:${scaledViewport.height}px;" />
  </body>
</html>
`);

  return frameHtmlPath;
}

function renderConcatManifest(framePaths, frameDurationsS) {
  const lines = [];

  for (const [index, framePath] of framePaths.entries()) {
    lines.push(`file '${escapeForConcat(framePath)}'`);
    lines.push(`duration ${frameDurationsS[index]}`);
  }

  lines.push(`file '${escapeForConcat(framePaths.at(-1))}'`);
  return `${lines.join('\n')}\n`;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    throw new Error([`Command failed: ${command} ${args.join(' ')}`, stderr, stdout].filter(Boolean).join('\n\n'));
  }
}

function assertAvailable(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8', stdio: 'pipe' });

  if (result.status !== 0) {
    throw new Error(`Required command not found: ${command}`);
  }
}

function escapeForSingleQuotes(value) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "'\"'\"'");
}

function escapeForConcat(value) {
  return value.replaceAll("'", "'\\''");
}
