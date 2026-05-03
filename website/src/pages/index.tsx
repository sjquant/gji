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
  'gji is a Git worktree CLI with warp navigation, pull request review, and branch-isolated workflows across active repositories.';

const siteKeywords = [
  'git worktree cli',
  'git worktree navigation',
  'git warp command',
  'multi repo worktree',
  'pull request review cli',
  'git stash alternative',
  'developer productivity',
  'ai coding workflow',
];

const heroStats = [
  {
    value: 'Cross-repo warp',
    label: 'Jump to any registered repo worktree by branch name or repo/branch from one command.',
  },
  {
    value: 'PR review in isolation',
    label: 'Open review work in its own directory, then warp back to feature work when you are done.',
  },
  {
    value: 'Scriptable paths',
    label: 'Use stable worktree locations and JSON output for shells, editors, and coding agents.',
  },
];

const heroChecklist = [
  'Warp across registered repos without changing your starting directory',
  'Create a fresh worktree in another repo with `gji warp --new`',
  'Use `--json` when scripts or agents need the resolved worktree path',
];

const heroWorkflow = [
  {
    command: 'gji warp feature/payment-refactor',
    detail: 'Jump straight to an existing worktree, even when it lives in another registered repo.',
  },
  {
    command: 'gji warp api/main',
    detail: 'Target an exact repo and branch when several repositories carry the same branch names.',
  },
  {
    command: 'gji warp --new fix/copy-regression',
    detail: 'Create a new worktree from the same entry point when the next task belongs in another repo.',
  },
];

const workflowSteps = [
  {
    title: 'Warp to active work instantly',
    body: 'Search all registered repos for a branch and enter the matching worktree without cd-ing into each repo first.',
  },
  {
    title: 'Create from the same entry point',
    body: 'Use `gji warp --new` when the task belongs in another repo but you still want one command and one picker.',
  },
  {
    title: 'Return without losing context',
    body: 'Pair `warp` with `back`, `history`, and `open` so navigation stays fast for both human and AI-assisted work.',
  },
];

const featureCards = [
  {
    title: 'Cross-repo navigation that stays branch-first',
    body: 'Move by branch name or repo/branch instead of remembering where each checkout currently lives on disk.',
  },
  {
    title: 'Structured output for tooling',
    body: 'Use `warp --json`, predictable paths, and shell handoff to plug gji into scripts, editors, and agent workflows.',
  },
  {
    title: 'Still handles the rest of the worktree lifecycle',
    body: 'Open PRs, sync branches, clean stale worktrees, and rerun hooks without falling back to manual path juggling.',
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
    body: 'See the shortest path from warp navigation to PR review to cleanup.',
    href: '/docs/quick-start',
    label: 'Read quick start',
  },
  {
    title: 'Command Reference',
    body: 'Review `warp`, `back`, `open`, and the rest of the day-to-day command surface.',
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
      title="Warp Across Git Worktrees Without The Hassle"
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
      <meta property="og:title" content="gji | Warp across Git worktrees without the hassle" />
      <meta property="og:description" content={siteDescription} />
      <meta property="og:url" content={siteUrl} />
      <meta property="og:image" content={socialImageUrl} />
      <meta
        property="og:image:alt"
        content="gji social card showing warp-based Git worktree navigation across repositories"
      />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="gji | Warp across Git worktrees without the hassle" />
      <meta name="twitter:description" content={siteDescription} />
      <meta name="twitter:image" content={socialImageUrl} />
      <meta
        name="twitter:image:alt"
        content="gji social card showing warp-based Git worktree navigation across repositories"
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
          <p className={styles.eyebrow}>Git worktree warp</p>
          <h1 className={styles.heroTitle}>Warp across worktrees without losing your place</h1>
          <p className={styles.heroLead}>
            <code>gji</code> turns Git worktrees into a branch-first navigation flow,
            with <code>warp</code> for cross-repo jumps, isolated PR review, and
            clean handoff into the exact directory you need next.
          </p>
          <p className={styles.heroSupport}>
            When several repos, reviews, experiments, and AI-assisted tasks are open
            at once, <code>warp</code> gives you one entry point instead of a pile of
            remembered paths.
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
        <p className={styles.commandEyebrow}>Warp flow</p>
        <h2 className={styles.commandTitle}>One command for cross-repo context switching</h2>
        <p className={styles.commandSummary}>
          Keep each task in its own worktree, then move by branch intent instead of
          by terminal tab memory.
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
        <span className={styles.commandFootnoteLabel}>Resolver format</span>
        <code>branch or repo/branch</code>
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
          <h2 className={styles.sectionTitle}>Stop path hunting when several repos are active</h2>
        </div>
        <div className={styles.problemBox}>
          <p className={styles.problemLabel}>Without gji</p>
          <p>
            Remember which repo holds the branch, hop between directories manually,
            then still deal with stash, checkout, reinstall, and cleanup churn.
          </p>
        </div>
        <div className={styles.solutionBox}>
          <p className={styles.problemLabel}>With gji</p>
          <p>
            Keep tasks isolated, then warp straight to the branch you want across
            registered repos without interrupting what is already open.
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
        <h2 className={styles.sectionTitle}>Built for the boring moments that usually break flow</h2>
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
        <h2 className={styles.sectionTitle}>A better default for multi-repo, multi-branch work</h2>
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
