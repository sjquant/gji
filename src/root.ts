import { writeFile } from 'node:fs/promises';
import { detectRepository } from './repo.js';

export interface RootCommandOptions {
  cwd: string;
  print?: boolean;
  stdout: (chunk: string) => void;
}

const ROOT_OUTPUT_FILE_ENV = 'GJI_ROOT_OUTPUT_FILE';

export async function runRootCommand(options: RootCommandOptions): Promise<number> {
  const repository = await detectRepository(options.cwd);
  const output = `${repository.repoRoot}\n`;

  if (!options.print && process.env[ROOT_OUTPUT_FILE_ENV]) {
    await writeFile(process.env[ROOT_OUTPUT_FILE_ENV], output, 'utf8');
    return 0;
  }

  options.stdout(output);

  return 0;
}
