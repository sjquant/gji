import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

import { isCancel, select } from '@clack/prompts';

export type PathConflictChoice = 'abort' | 'reuse';

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function promptForPathConflict(path: string): Promise<PathConflictChoice> {
  const choice = await select<PathConflictChoice>({
    message: `Target path already exists: ${path}`,
    options: [
      { value: 'abort', label: 'Abort', hint: 'Keep the existing directory untouched' },
      { value: 'reuse', label: 'Reuse path', hint: 'Print the existing path and stop' },
    ],
  });

  if (isCancel(choice)) {
    return 'abort';
  }

  return choice;
}
