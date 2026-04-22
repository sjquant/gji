import type {ReactNode} from 'react';
import clsx from 'clsx';
import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

import styles from './index.module.css';

type Card = {
  title: string;
  body: string;
  href: string;
  label: string;
};

const commandHighlights = [
  'gji new feature/payment-refactor',
  'gji pr 1234',
  'gji go main',
  'gji sync --all',
];

const heroStats = [
  {
    value: 'Feature branches',
    label: 'Open a clean worktree without disturbing the branch already in progress.',
  },
  {
    value: 'Pull request review',
    label: 'Inspect PRs in their own directory instead of reusing one mutable checkout.',
  },
  {
    value: 'Predictable paths',
    label: 'Keep editors, shell history, hooks, and scripts pointed at stable locations.',
  },
];

const heroChecklist = [
  'Separate branch directories by default',
  'Branch-specific installs and build state',
  'Fast return to the work you were already doing',
];

const heroWorkflow = [
  {
    command: 'gji new feature/payment-refactor',
    detail: 'Start a task in its own worktree and land in the new directory immediately.',
  },
  {
    command: 'gji pr 1234',
    detail: 'Open a pull request in isolation instead of mutating your active checkout.',
  },
  {
    command: 'gji go main',
    detail: 'Jump back to a familiar path without stash, checkout, or reinstall churn.',
  },
];

const workflowSteps = [
  {
    title: 'Open a new task cleanly',
    body: 'Create a branch and its worktree together instead of mutating your current checkout.',
  },
  {
    title: 'Review pull requests in isolation',
    body: 'Fetch a PR into its own directory so review work never collides with feature work.',
  },
  {
    title: 'Jump back without cleanup rituals',
    body: 'Switch contexts instantly because each branch already has its own path and dependency state.',
  },
];

const featureCards = [
  {
    title: 'Separate dependencies per branch',
    body: 'Each worktree keeps its own install state, build outputs, and shell context.',
  },
  {
    title: 'Deterministic paths',
    body: 'Worktrees land in a stable location so scripts and editor bookmarks can target them reliably.',
  },
  {
    title: 'Built for day-to-day maintenance',
    body: 'Use `sync`, `clean`, `remove`, and hooks to keep long-lived repos under control.',
  },
];

const docsCards: Card[] = [
  {
    title: 'Installation',
    body: 'Install the CLI and wire shell handoff into zsh or bash.',
    href: '/docs/installation',
    label: 'Install gji',
  },
  {
    title: 'Quick Start',
    body: 'See the shortest path from feature branch to PR review to cleanup.',
    href: '/docs/quick-start',
    label: 'Read quick start',
  },
  {
    title: 'Configuration',
    body: 'Set branch prefixes, sync behavior, copied files, and per-repo overrides.',
    href: '/docs/configuration',
    label: 'Configure defaults',
  },
];

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const siteUrl = `${siteConfig.url}${siteConfig.baseUrl}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'gji',
    applicationCategory: 'DeveloperApplication',
    description:
      'A Git worktree CLI for fast context switching, pull request review, and branch-isolated workflows.',
    url: siteUrl,
    downloadUrl: 'https://www.npmjs.com/package/@solaqua/gji',
    codeRepository: 'https://github.com/sjquant/gji',
    keywords: [
      'git worktree cli',
      'git worktree tool',
      'pull request review cli',
      'git stash alternative',
      'developer productivity',
    ],
  };

  return (
    <Layout
      title="Git worktrees without the hassle"
      description="gji is a fast Git worktree CLI for pull request review, parallel tasks, and zero-stash context switching.">
      <SiteHead siteUrl={siteUrl} jsonLd={jsonLd} />
      <main className={styles.page}>
        <HeroSection />
        <ProofSection />
        <WorkflowSection />
        <FeaturesSection />
        <DocsSection />
      </main>
    </Layout>
  );
}

function SiteHead({
  siteUrl,
  jsonLd,
}: {
  siteUrl: string;
  jsonLd: Record<string, unknown>;
}): ReactNode {
  return (
    <Head>
      <meta
        name="keywords"
        content="git worktree cli, git worktree tool, pull request review cli, git stash alternative, developer productivity"
      />
      <meta property="og:type" content="website" />
      <meta property="og:title" content="gji | Git worktrees without the hassle" />
      <meta
        property="og:description"
        content="A fast Git worktree CLI for pull request review, parallel tasks, and zero-stash context switching."
      />
      <meta property="og:url" content={siteUrl} />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content="gji | Git worktrees without the hassle" />
      <meta
        name="twitter:description"
        content="A fast Git worktree CLI for pull request review, parallel tasks, and zero-stash context switching."
      />
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
    </Head>
  );
}

function HeroSection(): ReactNode {
  return (
    <section className={styles.hero}>
      <div className={clsx('container', styles.heroInner)}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Git worktree CLI</p>
          <h1 className={styles.heroTitle}>Git worktrees without the hassle</h1>
          <p className={styles.heroLead}>
            <code>gji</code> keeps feature work, pull request review, and cleanup in
            separate directories so switching context feels controlled instead of
            disruptive.
          </p>
          <p className={styles.heroSupport}>
            It is the same Git worktree capability, packaged as a cleaner daily
            workflow for real repositories with parallel work.
          </p>
          <div className={styles.ctaRow}>
            <Link
              className={clsx('button button--lg', styles.primaryButton)}
              to="/docs/installation">
              Install
            </Link>
            <Link
              className={clsx('button button--lg', styles.secondaryButton)}
              to="/docs/quick-start">
              Quick Start
            </Link>
          </div>
          <ul className={styles.heroChecklist}>
            {heroChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <HeroWorkflowPanel />
      </div>
      <div className={clsx('container', styles.proofStrip)}>
        {heroStats.map((point) => (
          <article key={point.value} className={styles.proofPill}>
            <h2>{point.value}</h2>
            <p>{point.label}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function HeroWorkflowPanel(): ReactNode {
  return (
    <section className={styles.commandPanel} aria-label="Workflow preview">
      <div className={styles.commandIntro}>
        <p className={styles.commandEyebrow}>Typical session</p>
        <h2 className={styles.commandTitle}>A cleaner way to move between tasks</h2>
        <p className={styles.commandSummary}>
          Keep each task in its own worktree, keep paths predictable, and stop
          turning one checkout into a temporary everything-box.
        </p>
      </div>
      <div className={styles.workflowList}>
        {heroWorkflow.map((item) => (
          <article key={item.command} className={styles.workflowItem}>
            <code className={styles.workflowCommand}>{item.command}</code>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
      <div className={styles.commandFootnote}>
        <span className={styles.commandFootnoteLabel}>Path layout</span>
        <code>../worktrees/&lt;repo&gt;/&lt;branch&gt;</code>
      </div>
    </section>
  );
}

function ProofSection(): ReactNode {
  return (
    <section className={styles.band}>
      <div className={clsx('container', styles.bandGrid)}>
        <div>
          <p className={styles.sectionLabel}>What changes</p>
          <h2 className={styles.sectionTitle}>Stop mutating one checkout for every task</h2>
        </div>
        <div className={styles.problemBox}>
          <p className={styles.problemLabel}>Without gji</p>
          <p>
            Stash changes, checkout another branch, reinstall dependencies, do the
            work, then unwind the whole sequence.
          </p>
        </div>
        <div className={styles.solutionBox}>
          <p className={styles.problemLabel}>With gji</p>
          <p>
            Open each task in its own worktree and move between them directly when
            you need context, review, or cleanup.
          </p>
        </div>
      </div>
    </section>
  );
}

function WorkflowSection(): ReactNode {
  return (
    <section className={styles.section}>
      <div className="container">
        <p className={styles.sectionLabel}>Core workflow</p>
        <h2 className={styles.sectionTitle}>Built for the boring moments that waste time</h2>
        <div className={styles.stepGrid}>
          {workflowSteps.map((step) => (
            <article key={step.title} className={styles.stepCard}>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection(): ReactNode {
  return (
    <section className={styles.sectionAlt}>
      <div className="container">
        <p className={styles.sectionLabel}>Why teams keep it around</p>
        <h2 className={styles.sectionTitle}>A better default for multi-branch work</h2>
        <div className={styles.cardGrid}>
          {featureCards.map((card) => (
            <article key={card.title} className={styles.featureCard}>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function DocsSection(): ReactNode {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.docsIntro}>
          <div>
            <p className={styles.sectionLabel}>Documentation</p>
            <h2 className={styles.sectionTitle}>Start with the parts you actually need</h2>
          </div>
          <Link className={styles.inlineLink} to="/docs/commands">
            See command reference
          </Link>
        </div>
        <div className={styles.docsGrid}>
          {docsCards.map((card) => (
            <article key={card.title} className={styles.docsCard}>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              <Link className={styles.docsLink} to={card.href}>
                {card.label}
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
