import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'gji',
  tagline: 'Git worktrees without the hassle',
  favicon: 'img/favicon.ico',
  future: {
    v4: true,
  },
  url: 'https://sjquant.github.io',
  baseUrl: '/gji/',
  organizationName: 'sjquant',
  projectName: 'gji',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  customFields: {
    githubUrl: 'https://github.com/sjquant/gji',
    npmUrl: 'https://www.npmjs.com/package/@solaqua/gji',
  },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/sjquant/gji/tree/main/website/',
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  plugins: ['./plugins/clipboard-fallback'],
  themeConfig: {
    image: 'img/social-card.png',
    metadata: [
      {
        name: 'keywords',
        content: 'git worktree cli, git worktree navigation, multi repo worktree, pull request review cli, git stash alternative, ai coding workflow',
      },
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
    ],
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'gji',
      logo: {
        alt: 'gji logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'dropdown',
          position: 'left',
          label: 'Docs',
          items: [
            {
              label: 'Overview',
              to: '/docs/intro',
            },
            {
              label: 'Comparison',
              to: '/docs/comparison',
            },
            {
              label: 'Installation',
              to: '/docs/installation',
            },
            {
              label: 'Quick Start',
              to: '/docs/quick-start',
            },
            {
              label: 'Daily Workflow',
              to: '/docs/daily-workflow',
            },
            {
              label: 'Commands',
              to: '/docs/commands',
            },
            {
              label: 'Configuration',
              to: '/docs/configuration',
            },
            {
              label: 'Troubleshooting',
              to: '/docs/troubleshooting',
            },
          ],
        },
        {
          href: 'https://www.npmjs.com/package/@solaqua/gji',
          label: 'npm',
          position: 'right',
        },
        {
          href: 'https://github.com/sjquant/gji',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Overview',
              to: '/docs/intro',
            },
            {
              label: 'Quick Start',
              to: '/docs/quick-start',
            },
          ],
        },
        {
          title: 'Project',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/sjquant/gji',
            },
            {
              label: 'npm',
              href: 'https://www.npmjs.com/package/@solaqua/gji',
            },
            {
              label: 'Issues',
              href: 'https://github.com/sjquant/gji/issues',
            },
          ],
        },
        {
          title: 'Why gji',
          items: [
            {
              label: 'Comparison',
              to: '/docs/comparison',
            },
            {
              label: 'Hooks',
              to: '/docs/hooks',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} sjquant. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.dracula,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
