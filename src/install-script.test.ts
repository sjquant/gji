import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const installScriptPath = resolve(process.cwd(), 'install.sh');

describe('install.sh', () => {
  it('installs gji into a user-local prefix for supported linux x64 hosts', async () => {
    // Given an isolated HOME and stubbed node/npm executables.
    const home = await mkdtemp(join(tmpdir(), 'gji-install-home-'));
    const binDir = join(home, 'stubs');
    const npmArgsPath = join(home, 'npm-args.txt');
    await mkdir(binDir, { recursive: true });
    await writeExecutable(
      join(binDir, 'node'),
      '#!/bin/sh\nexit 0\n',
    );
    await writeExecutable(
      join(binDir, 'npm'),
      `#!/bin/sh
printf '%s\n' "$@" > "${npmArgsPath}"
prefix=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--prefix" ]; then
    prefix="$arg"
  fi
  prev="$arg"
done
mkdir -p "$prefix/bin"
cat <<'EOF' > "$prefix/bin/gji"
#!/bin/sh
exit 0
EOF
chmod +x "$prefix/bin/gji"
`,
    );

    // When the installer runs with shell setup disabled.
    await execFileAsync('sh', [installScriptPath], {
      env: {
        ...process.env,
        GJI_NO_SHELL_SETUP: '1',
        GJI_TEST_UNAME_M: 'x86_64',
        GJI_TEST_UNAME_S: 'Linux',
        HOME: home,
        PATH: `${binDir}:/usr/bin:/bin`,
        SHELL: '/bin/zsh',
      },
    });

    // Then npm installs into the expected local prefix and the binary is linked.
    await expect(readFile(npmArgsPath, 'utf8')).resolves.toContain(`--prefix\n${home}/.local/share/gji`);
    await expect(readFile(join(home, '.local', 'bin', 'gji'), 'utf8')).resolves.toContain('#!/bin/sh');
  });

  it('writes a zsh startup block when shell setup is enabled', async () => {
    // Given an isolated HOME and stubbed node/npm executables.
    const home = await mkdtemp(join(tmpdir(), 'gji-install-home-'));
    const binDir = join(home, 'stubs');
    await mkdir(binDir, { recursive: true });
    await writeExecutable(
      join(binDir, 'node'),
      '#!/bin/sh\nexit 0\n',
    );
    await writeExecutable(
      join(binDir, 'npm'),
      `#!/bin/sh
prefix=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--prefix" ]; then
    prefix="$arg"
  fi
  prev="$arg"
done
mkdir -p "$prefix/bin"
cat <<'EOF' > "$prefix/bin/gji"
#!/bin/sh
if [ "$1" = "init" ]; then
  echo "# fake init $2"
fi
EOF
chmod +x "$prefix/bin/gji"
`,
    );

    // When the installer runs for a zsh shell.
    await execFileAsync('sh', [installScriptPath], {
      env: {
        ...process.env,
        GJI_TEST_UNAME_M: 'arm64',
        GJI_TEST_UNAME_S: 'Darwin',
        HOME: home,
        PATH: `${binDir}:/usr/bin:/bin`,
        SHELL: '/bin/zsh',
      },
    });

    // Then the zsh rc file contains the installer block with PATH and gji init.
    const rcContents = await readFile(join(home, '.zshrc'), 'utf8');
    expect(rcContents).toContain('# >>> gji install >>>');
    expect(rcContents).toContain(`case ":$PATH:" in`);
    expect(rcContents).toContain(`*:"${home}/.local/bin":*) ;;`);
    expect(rcContents).toContain(`*) export PATH="${home}/.local/bin:$PATH" ;;`);
    expect(rcContents).toContain(`eval "$("${home}/.local/bin/gji" init zsh)"`);
    expect(rcContents).toContain('# <<< gji install <<<');
  });

  it('fails for unsupported operating systems before attempting installation', async () => {
    // Given an isolated HOME and stubbed node/npm executables.
    const home = await mkdtemp(join(tmpdir(), 'gji-install-home-'));
    const binDir = join(home, 'stubs');
    await mkdir(binDir, { recursive: true });
    await writeExecutable(
      join(binDir, 'node'),
      '#!/bin/sh\nexit 0\n',
    );
    await writeExecutable(
      join(binDir, 'npm'),
      '#!/bin/sh\nexit 0\n',
    );

    // When the installer runs on an unsupported OS.
    const result = await execFileAsync('sh', [installScriptPath], {
      env: {
        ...process.env,
        GJI_TEST_UNAME_M: 'x86_64',
        GJI_TEST_UNAME_S: 'FreeBSD',
        HOME: home,
        PATH: `${binDir}:/usr/bin:/bin`,
        SHELL: '/bin/zsh',
      },
      windowsHide: true,
    }).catch((error: Error & { code?: number; stderr?: string }) => error);

    // Then it exits with a clear unsupported-platform error.
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Unsupported operating system: FreeBSD');
  });
});

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, 'utf8');
  await chmod(path, 0o755);
}
