import { spawn } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import { isCancel, select } from '@clack/prompts';
import { loadEffectiveConfig, resolveConfigString, updateGlobalConfigKey } from './config.js';
import { isHeadless } from './headless.js';
import { detectRepository, listWorktrees, sortByCurrentFirst, type WorktreeEntry } from './repo.js';

const execFileAsync = promisify(execFile);

interface EditorDefinition {
  cli: string;
  name: string;
  newWindowFlag?: string;
  supportsWorkspace: boolean;
}

// Ordered by likely popularity among the target audience.
const EDITORS: EditorDefinition[] = [
  { cli: 'cursor', name: 'Cursor', newWindowFlag: '--new-window', supportsWorkspace: true },
  { cli: 'code', name: 'VS Code', newWindowFlag: '--new-window', supportsWorkspace: true },
  { cli: 'windsurf', name: 'Windsurf', newWindowFlag: '--new-window', supportsWorkspace: true },
  { cli: 'zed', name: 'Zed', supportsWorkspace: false },
  { cli: 'subl', name: 'Sublime Text', newWindowFlag: '--new-window', supportsWorkspace: false },
];

export interface OpenCommandOptions {
  branch?: string;
  cwd: string;
  editor?: string;
  save?: boolean;
  stderr: (chunk: string) => void;
  stdout: (chunk: string) => void;
  workspace?: boolean;
}

export interface OpenCommandDependencies {
  detectEditors: () => Promise<EditorDefinition[]>;
  promptForEditor: (editors: EditorDefinition[]) => Promise<string | null>;
  promptForWorktree: (worktrees: WorktreeEntry[]) => Promise<string | null>;
  spawnEditor: (cli: string, args: string[]) => Promise<void>;
}

export function createOpenCommand(
  dependencies: Partial<OpenCommandDependencies> = {},
): (options: OpenCommandOptions) => Promise<number> {
  const detectEditors = dependencies.detectEditors ?? detectInstalledEditors;
  const promptForEditor = dependencies.promptForEditor ?? defaultPromptForEditor;
  const promptForWorktree = dependencies.promptForWorktree ?? defaultPromptForWorktree;
  const spawnEditor = dependencies.spawnEditor ?? defaultSpawnEditor;

  return async function runOpenCommand(options: OpenCommandOptions): Promise<number> {
    const [worktrees, repository] = await Promise.all([
      listWorktrees(options.cwd),
      detectRepository(options.cwd),
    ]);

    // Resolve target worktree path.
    let targetPath: string;
    if (options.branch) {
      const entry = worktrees.find((w) => w.branch === options.branch);
      if (!entry) {
        options.stderr(`gji open: no worktree found for branch: ${options.branch}\n`);
        options.stderr(`Hint: Use 'gji ls' to see available worktrees\n`);
        return 1;
      }
      targetPath = entry.path;
    } else if (isHeadless()) {
      targetPath = worktrees.find((w) => w.isCurrent)?.path ?? options.cwd;
    } else {
      const chosen = await promptForWorktree(sortByCurrentFirst(worktrees));
      if (!chosen) {
        options.stderr('Aborted\n');
        return 1;
      }
      targetPath = chosen;
    }

    // Resolve which editor to use.
    const config = await loadEffectiveConfig(repository.repoRoot, undefined, options.stderr);
    const savedEditor = resolveConfigString(config, 'editor');

    let editorCli: string;
    if (options.editor) {
      editorCli = options.editor;
    } else if (savedEditor) {
      editorCli = savedEditor;
    } else {
      const installed = await detectEditors();
      if (installed.length === 0) {
        options.stderr(
          'gji open: no supported editor detected. Use --editor <code|cursor|zed|...> to specify one.\n',
        );
        return 1;
      }
      if (installed.length === 1 || isHeadless()) {
        editorCli = installed[0].cli;
      } else {
        const chosen = await promptForEditor(installed);
        if (!chosen) {
          options.stderr('Aborted\n');
          return 1;
        }
        editorCli = chosen;
      }
    }

    // Persist editor choice when requested.
    if (options.save && editorCli !== savedEditor) {
      await updateGlobalConfigKey('editor', editorCli);
      const displayName = EDITORS.find((e) => e.cli === editorCli)?.name ?? editorCli;
      options.stdout(`Saved editor "${displayName}" to global config\n`);
    }

    // Build open args.
    const editorDef = EDITORS.find((e) => e.cli === editorCli);
    let openTarget = targetPath;

    if (options.workspace && editorDef?.supportsWorkspace) {
      openTarget = await ensureWorkspaceFile(targetPath, repository.repoName);
    }

    const args: string[] = [];
    if (editorDef?.newWindowFlag) {
      args.push(editorDef.newWindowFlag);
    }
    args.push(openTarget);

    try {
      await spawnEditor(editorCli, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.stderr(`gji open: failed to launch editor: ${message}\n`);
      return 1;
    }

    const displayName = editorDef?.name ?? editorCli;
    options.stdout(`Opened ${targetPath} in ${displayName}\n`);
    return 0;
  };
}

export const runOpenCommand = createOpenCommand();

async function detectInstalledEditors(): Promise<EditorDefinition[]> {
  const results = await Promise.all(
    EDITORS.map(async (editor) => ({ editor, available: await isCommandAvailable(editor.cli) })),
  );
  return results.filter((r) => r.available).map((r) => r.editor);
}

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync('which', [command]);
    return true;
  } catch {
    return false;
  }
}

async function defaultPromptForWorktree(worktrees: WorktreeEntry[]): Promise<string | null> {
  const choice = await select<string>({
    message: 'Choose a worktree to open',
    options: worktrees.map((w) => ({
      value: w.path,
      label: w.branch ?? '(detached)',
      hint: w.isCurrent ? `${w.path} (current)` : w.path,
    })),
  });

  if (isCancel(choice)) return null;
  return choice;
}

async function defaultPromptForEditor(editors: EditorDefinition[]): Promise<string | null> {
  const choice = await select<string>({
    message: 'Choose an editor',
    options: editors.map((e) => ({ value: e.cli, label: e.name })),
  });

  if (isCancel(choice)) return null;
  return choice;
}

async function defaultSpawnEditor(cli: string, args: string[]): Promise<void> {
  const child = spawn(cli, args, { detached: true, stdio: 'ignore' });

  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });

  child.unref();
}

async function ensureWorkspaceFile(worktreePath: string, repoName: string): Promise<string> {
  const workspacePath = join(worktreePath, `${repoName}.code-workspace`);

  try {
    await access(workspacePath);
    return workspacePath;
  } catch {
    // File doesn't exist yet — create it.
  }

  const workspace = { folders: [{ path: '.' }], settings: {} };
  await writeFile(workspacePath, `${JSON.stringify(workspace, null, 2)}\n`, 'utf8');
  return workspacePath;
}
