import { detectRepository } from './repo.js';

export interface RootCommandOptions {
  cwd: string;
  stdout: (chunk: string) => void;
}

export async function runRootCommand(options: RootCommandOptions): Promise<number> {
  const repository = await detectRepository(options.cwd);

  options.stdout(`${repository.repoRoot}\n`);

  return 0;
}
