#!/usr/bin/env node
/**
 * Bundles the CLI for Homebrew distribution.
 *
 * Outputs:
 *   dist/gji-bundle.mjs — ESM bundle (all source + deps inlined)
 *   dist/gji            — CJS launcher with shebang that dynamic-imports the bundle
 */
import { build } from 'esbuild';
import { chmod, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// The createRequire banner makes `require` available inside the ESM bundle so
// that CJS packages bundled via __commonJS (e.g. commander) can resolve
// node built-ins at runtime instead of hitting the "Dynamic require" error.
await build({
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(root, 'dist/gji-bundle.mjs'),
  target: 'node18',
  minify: false,
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});

// The launcher is intentionally CJS (no imports) so Node.js loads it as
// CommonJS regardless of the project's "type":"module" setting. Dynamic
// import() is valid in CJS and resolves relative to the file's own path.
const launcher = [
  '#!/usr/bin/env node',
  "import('./gji-bundle.mjs').catch(err => {",
  "  process.stderr.write(err.message + '\\n');",
  '  process.exit(1);',
  '});',
  '',
].join('\n');

await writeFile(join(root, 'dist/gji'), launcher, 'utf8');
await chmod(join(root, 'dist/gji'), 0o755);

console.log('Bundled → dist/gji-bundle.mjs + dist/gji');
