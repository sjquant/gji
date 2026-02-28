export function printInfo(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function printSuccess(message: string): void {
  process.stdout.write(`OK: ${message}\n`);
}

export function printWarning(message: string): void {
  process.stderr.write(`WARN: ${message}\n`);
}

export function printError(message: string): void {
  process.stderr.write(`ERROR: ${message}\n`);
}

export function formatWorkspaceCreated(destinationPath: string): string {
  return `Workspace created at ${destinationPath}`;
}

export function formatWorkspaceFailed(reason: string): string {
  return `Workspace creation failed: ${reason}`;
}
