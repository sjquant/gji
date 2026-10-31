import Head from "@docusaurus/Head";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import type { ReactNode } from "react";

import WorkflowDemo from "../components/WorkflowDemo";
import styles from "./index.module.css";

const description =
	"Open a new task or review a PR. Your current work stays right where you left it. gji makes Git worktrees part of your everyday shell workflow.";

export default function Home(): ReactNode {
	const { siteConfig } = useDocusaurusContext();
	const siteUrl = `${siteConfig.url}${siteConfig.baseUrl}`;
	return (
		<Layout title="Switch tasks. Keep your place." description={description}>
			<Head>
				<meta property="og:type" content="website" />
				<meta
					property="og:title"
					content="gji — Switch tasks. Keep your place."
				/>
				<meta property="og:description" content={description} />
				<meta property="og:image" content={`${siteUrl}img/social-card.png`} />
				<meta
					property="og:image:alt"
					content="gji: Switch tasks. Keep your place. A Git worktree CLI."
				/>
				<script type="application/ld+json">
					{JSON.stringify({
						"@context": "https://schema.org",
						"@type": "SoftwareApplication",
						name: "gji",
						applicationCategory: "DeveloperApplication",
						description,
						url: siteUrl,
						codeRepository: "https://github.com/sjquant/gji",
						downloadUrl: "https://www.npmjs.com/package/@solaqua/gji",
					})}
				</script>
			</Head>
			<main className={styles.page}>
				<section className={styles.hero}>
					<p className={styles.eyebrow}>Git worktree CLI</p>
					<h1>
						Switch tasks.
						<br />
						Keep your place.
					</h1>
					<p className={styles.lead}>
						Open a new task or review a PR.
						<br /> Your current work stays right where you left it.
					</p>
					<div className={styles.actions}>
						<Link className={styles.primary} to="/docs/installation">
							Install gji
						</Link>
						<Link className={styles.secondary} to="/docs/quick-start">
							Quick start <span aria-hidden="true">→</span>
						</Link>
					</div>
					<Link className={styles.install} to="/docs/installation">
						<code>npm install -g @solaqua/gji</code>
						<span aria-hidden="true">↗</span>
					</Link>
				</section>
				<WorkflowDemo />
				<section
					className={styles.explanation}
					aria-label="Work with your existing tools"
				>
					<p>
						Each task gets its own directory, files, and dependencies.
						<br />
						Keep using your usual Git commands, editor, and coding tools.
					</p>
					<p className={styles.referenceLinks}>
						<Link to="/docs/quick-start">Quick start</Link>
						<span aria-hidden="true">·</span>
						<Link to="/docs/commands">Command reference</Link>
					</p>
				</section>
			</main>
		</Layout>
	);
}
