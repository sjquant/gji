#!/usr/bin/env node

import { runCli } from './cli.js';

async function main(): Promise<void> {
  try {
    const result = await runCli(process.argv.slice(2), {
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

void main();
