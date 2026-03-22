import { describe, expect, it } from 'vitest';

import { runCli } from './cli.js';
import packageJson from '../package.json' with { type: 'json' };

describe('runCli', () => {
  it('prints help with the planned commands', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await runCli(['--help'], {
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    const output = stdout.join('');

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

  it('prints the package version', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await runCli(['--version'], {
      stderr: (chunk) => stderr.push(chunk),
      stdout: (chunk) => stdout.push(chunk),
    });

    expect(result.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('')).toBe(`${packageJson.version}\n`);
  });
});
