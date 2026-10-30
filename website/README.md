# gji website and docs

The landing page demonstrates one outcome: open another task and return to the
work you left behind. The docs take readers from that first success to daily
workflows and command reference.

## Run locally

From the repository root (Node.js 20+ for the site):

```bash
pnpm --dir website install --frozen-lockfile
pnpm --dir website start
```

## Check and build

```bash
pnpm --dir website typecheck
pnpm --dir website build
pnpm --dir website serve
```

The build checks internal document links. GitHub Actions deploys the Docusaurus
output to GitHub Pages; see [the docs workflow](../.github/workflows/docs.yml).

## Update the walkthrough and previews

The landing demo and README preview share
[`workflow-scenes.json`](src/components/workflow-scenes.json). Keep commands,
branch names and preserved edits consistent across the whole story.
The demo is an illustration, not a recording of CLI output. Don't imply that dependency setup runs at animation speed.

After changing the scenes, SVG logo, or SVG social card, regenerate the raster
assets from the repository root with `ffmpeg` installed:

```bash
pnpm generate:readme-demos
```

The script uses the development dependency `@resvg/resvg-js` to render SVGs, then updates:

- `.github/assets/readme-workflow.gif` and its PNG still.
- `website/static/img/social-card.png` from its SVG source.
- `website/static/img/favicon.ico` from the favicon SVG.

The README uses the still for reduced-motion preferences. The site demo has
manual scene selection, automatic looping with typing, hover/focus pause, and a reduced-motion default. Check the
landing page and a document in light and dark mode, plus the mobile navigation,
before shipping changes to shared styles.
