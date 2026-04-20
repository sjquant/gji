import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'installation',
    'quick-start',
    'commands',
    {
      type: 'category',
      label: 'Guides',
      items: ['configuration', 'hooks', 'faq'],
    },
  ],
};

export default sidebars;
