#!/usr/bin/env node

import { homedir } from 'node:os';

import { loadGlobalConfig } from './config.js';
import { runCli } from './cli.js';

async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2);

    // Warn once (until fixed) when shell integration hasn't been set up.
    // Only shown in interactive terminals — suppressed in pipes and after gji init --write.
    const isMetaArg = argv[0] === 'init'
      || argv[0] === '--version' || argv[0] === '-V'
      || argv[0] === '--help'    || argv[0] === '-h';
    if (process.stderr.isTTY === true && !isMetaArg) {
      await warnIfMissingShellIntegration();
    }

    const result = await runCli(argv, {
      stderr: (chunk) => process.stderr.write(chunk),
      stdout: (chunk) => process.stdout.write(chunk),
    });

    process.exitCode = result.exitCode;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'An unknown error occurred.';

    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

async function warnIfMissingShellIntegration(): Promise<void> {
  try {
    const { config } = await loadGlobalConfig(homedir());
    if (!config.shellIntegration) {
      const shellBin = (process.env.SHELL ?? '').split('/').at(-1);
      const shellArg =
        shellBin && ['bash', 'zsh', 'fish'].includes(shellBin) ? ` ${shellBin}` : '';
      process.stderr.write(
        `gji: shell integration not set up — run \`gji init${shellArg} --write\` to enable automatic cd.\n`,
      );
    }
  } catch {
    // best-effort; never block the command
  }
}

void main();
