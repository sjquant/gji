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

const siteDescription =
  'gji is a Git worktree CLI for pull request review, fast context switching, and branch-isolated workflows across active repositories.';

const siteKeywords = [
  'git worktree cli',
  'git worktree navigation',
  'multi repo worktree',
  'pull request review cli',
  'git stash alternative',
  'developer productivity',
  'ai coding workflow',
];

const heroStats = [
  {
    value: 'Feature work in isolation',
    label: 'Open a clean worktree without disturbing the branch, install state, or shell you already have open.',
  },
  {
    value: 'PR review in isolation',
    label: 'Fetch review work into its own directory instead of turning your main checkout into a temporary review branch.',
  },
  {
    value: 'Fast navigation',
    label: 'Use go, back, open, and warp to move between active tasks without path hunting or stash churn.',
  },
];

const heroChecklist = [
  'Create branches and worktrees together with `gji new`',
  'Review pull requests without mutating your current checkout',
  'Jump between tasks with `go`, `back`, `open`, and `warp`',
];

const heroWorkflow = [
  {
    command: 'gji new feature/payment-refactor',
    detail: 'Start a task in its own worktree and land in the new directory immediately.',
  },
  {
    command: 'gji pr 1234',
    detail: 'Open a pull request in isolation instead of mutating the checkout you were already using.',
  },
  {
    command: 'gji warp api/main',
    detail: 'When several repos are active, jump straight to the matching worktree by repo and branch.',
  },
];

const workflowSteps = [
  {
    title: 'Open a new task cleanly',
    body: 'Create a branch and worktree together instead of reshaping one mutable checkout over and over.',
  },
  {
    title: 'Review and inspect in parallel',
    body: 'Use dedicated worktrees for pull requests, investigations, and experiments so each task keeps its own state.',
  },
  {
    title: 'Move without losing momentum',
    body: 'Use `go`, `back`, `open`, and `warp` to re-enter work quickly when several branches or repos are active at once.',
  },
];

const featureCards = [
  {
    title: 'Separate dependencies per branch',
    body: 'Each worktree keeps its own install state, build outputs, and editor context instead of sharing one unstable checkout.',
  },
  {
    title: 'Predictable paths and scriptable output',
    body: 'Use stable worktree locations, shell handoff, and JSON output to plug gji into scripts, editors, and agent workflows.',
  },
  {
    title: 'Navigation is broader than one command',
    body: 'Warp covers cross-repo jumps, but the day-to-day flow also includes new, pr, go, back, open, sync, and cleanup.',
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
    body: 'See the shortest path from feature work to PR review to cleanup.',
    href: '/docs/quick-start',
    label: 'Read quick start',
  },
  {
    title: 'Command Reference',
    body: 'Review `new`, `pr`, `go`, `warp`, `back`, `open`, and the rest of the day-to-day command surface.',
    href: '/docs/commands',
    label: 'Browse commands',
  },
];

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const siteUrl = `${siteConfig.url}${siteConfig.baseUrl}`;
  const socialImageUrl = `${siteUrl}img/social-card.png`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'gji',
    applicationCategory: 'DeveloperApplication',
    description: siteDescription,
    url: siteUrl,
    downloadUrl: 'https://www.npmjs.com/package/@solaqua/gji',
    codeRepository: 'https://github.com/sjquant/gji',
    keywords: siteKeywords,
    image: socialImageUrl,
  };

  return (
    <Layout
      title="Git Worktrees Without The Hassle"
      description={siteDescription}>
      <SiteHead
        jsonLd={jsonLd}
        siteUrl={siteUrl}
        socialImageUrl={socialImageUrl}
      />
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
  jsonLd,
  siteUrl,
  socialImageUrl,
}: {
  jsonLd: Record<string, unknown>;
  siteUrl: string;
  socialImageUrl: string;
}): ReactNode {
  return (
    <Head>
      <meta name="keywords" content={siteKeywords.join(', ')} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content="gji | Git worktrees without the hassle" />
      <meta property="og:description" content={siteDescription} />
      <meta property="og:url" content={siteUrl} />
      <meta property="og:image" content={socialImageUrl} />
      <meta
        property="og:image:alt"
        content="gji social card with the gji logo and the subtitle Git worktrees without the hassle"
      />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="gji | Git worktrees without the hassle" />
      <meta name="twitter:description" content={siteDescription} />
      <meta name="twitter:image" content={socialImageUrl} />
      <meta
        name="twitter:image:alt"
        content="gji social card with the gji logo and the subtitle Git worktrees without the hassle"
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
            <code>gji</code> creates separate worktrees for feature work, pull
            request review, experiments, and cleanup.
          </p>
          <p className={styles.heroSupport}>
            It adds navigation, shell handoff, predictable paths, and commands for
            creating, opening, syncing, and removing worktrees.
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
        <h2 className={styles.commandTitle}>Move between active tasks without reusing one checkout</h2>
        <p className={styles.commandSummary}>
          Use one command set for creating worktrees, reviewing PRs, reopening
          existing tasks, and switching repos when needed.
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
        <span className={styles.commandFootnoteLabel}>Default path layout</span>
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
            work, then switch everything back.
          </p>
        </div>
        <div className={styles.solutionBox}>
          <p className={styles.problemLabel}>With gji</p>
          <p>
            Open each task in its own worktree and switch directly between feature
            work, PR review, cleanup, and cross-repo tasks.
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
        <h2 className={styles.sectionTitle}>Commands for the work between commits</h2>
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
