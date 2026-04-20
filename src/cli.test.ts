import { afterEach, describe, expect, it, vi } from 'vitest';

const notifierMocks = vi.hoisted(() => {
  const notify = vi.fn();
  const updateNotifier = vi.fn(() => ({ notify }));

  return { notify, updateNotifier };
});

vi.mock('update-notifier', () => ({
  default: notifierMocks.updateNotifier,
}));

import { runCli } from './cli.js';
import { createRepository } from './repo.test-helpers.js';
import packageJson from '../package.json' with { type: 'json' };

afterEach(() => {
  delete process.env.GJI_NO_TUI;
  restoreStreamTty(process.stdout);
  restoreStreamTty(process.stderr);
  notifierMocks.notify.mockClear();
  notifierMocks.updateNotifier.mockClear();
});

describe('runCli', () => {
  it('prints help with the planned commands', async () => {
    // Given output collectors for the CLI help text.
    const stdout: string[] = [];
    const stderr: string[] = [];

    // When the top-level help command runs.
    const result = await runCli(['--help'], {
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    const output = stdout.join('');

    // Then the planned commands appear in help output.
    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain('Usage: gji');
    expect(output).toContain('new');
    expect(output).toContain('init');
    expect(output).toContain('pr');
    expect(output).toContain('go');
    expect(output).toContain('status');
    expect(output).toContain('sync');
    expect(output).toContain('root');
    expect(output).toContain('ls');
    expect(output).toContain('clean');
    expect(output).toContain('remove');
    expect(output).toContain('rm');
  });

  it('describes gji pr as accepting generic PR references', async () => {
    // Given output collectors for the CLI help text.
    const stdout: string[] = [];
    const stderr: string[] = [];

    // When the top-level help command runs.
    const result = await runCli(['--help'], {
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    const output = stdout.join('');

    // Then the PR help text describes the supported ref formats.
    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain('pr [options] <ref>');
    expect(output).toContain('number');
    expect(output).toContain('#number');
    expect(output).toContain('URL');
  });

  it('prints the package version', async () => {
    // Given output collectors for the CLI version text.
    const stdout: string[] = [];
    const stderr: string[] = [];

    // When the version flag runs.
    const result = await runCli(['--version'], {
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    // Then only the package version is written to stdout.
    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('')).toBe(`${packageJson.version}\n`);
  });

  it('runs the update notifier before interactive commands', async () => {
    // Given an interactive terminal and a notifier probe.
    setStreamTty(process.stdout, true);
    setStreamTty(process.stderr, true);
    const repoRoot = await createRepository();

    // When an interactive command runs.
    const result = await runCli(['status'], {
      cwd: repoRoot,
      stderr: () => undefined,
      stdout: () => undefined,
    });

    // Then the notifier receives the package metadata once.
    expect(result.exitCode).toBe(0);
    expect(notifierMocks.updateNotifier).toHaveBeenCalledTimes(1);
    expect(notifierMocks.notify).toHaveBeenCalledTimes(1);
    expect(notifierMocks.updateNotifier).toHaveBeenCalledWith({
      pkg: { name: packageJson.name, version: packageJson.version },
    });
  });

  it('skips the update notifier in JSON mode', async () => {
    // Given an interactive terminal and a notifier probe.
    setStreamTty(process.stdout, true);
    setStreamTty(process.stderr, true);
    const repoRoot = await createRepository();

    // When a JSON command runs.
    const result = await runCli(['status', '--json'], {
      cwd: repoRoot,
      stderr: () => undefined,
      stdout: () => undefined,
    });

    // Then the notifier is suppressed for machine-readable output.
    expect(result.exitCode).toBe(0);
    expect(notifierMocks.updateNotifier).not.toHaveBeenCalled();
    expect(notifierMocks.notify).not.toHaveBeenCalled();
  });

  it('skips the update notifier in headless mode', async () => {
    // Given an interactive terminal and headless mode enabled.
    setStreamTty(process.stdout, true);
    setStreamTty(process.stderr, true);
    process.env.GJI_NO_TUI = '1';
    const repoRoot = await createRepository();

    // When a command runs in headless mode.
    const result = await runCli(['status'], {
      cwd: repoRoot,
      stderr: () => undefined,
      stdout: () => undefined,
    });

    // Then the notifier stays silent.
    expect(result.exitCode).toBe(0);
    expect(notifierMocks.updateNotifier).not.toHaveBeenCalled();
    expect(notifierMocks.notify).not.toHaveBeenCalled();
  });
});

function setStreamTty(
  stream: NodeJS.WriteStream,
  value: boolean,
): void {
  Object.defineProperty(stream, 'isTTY', {
    configurable: true,
    value,
    writable: true,
  });
}

function restoreStreamTty(stream: NodeJS.WriteStream): void {
  delete (stream as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
}
