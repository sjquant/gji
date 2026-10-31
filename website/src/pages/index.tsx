import Head from "@docusaurus/Head";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import { type ReactNode, useState } from "react";

import WorkflowDemo from "../components/WorkflowDemo";
import styles from "./index.module.css";

const description =
	"Open a new task or review a PR. Your current work stays right where you left it. gji makes Git worktrees part of your everyday shell workflow.";

export default function Home(): ReactNode {
	const [copyStatus, setCopyStatus] = useState("Copy");
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
						<Link className={styles.primary} to="/docs/quick-start">
							Quick start
						</Link>
						<a className={styles.secondary} href="#workflow">
							See the workflow <span aria-hidden="true">↓</span>
						</a>
					</div>
					<div className={styles.install}>
						<code>npm install -g @solaqua/gji</code>
						<button
							type="button"
							onClick={async () => {
								try {
									await navigator.clipboard.writeText(
										"npm install -g @solaqua/gji",
									);
									setCopyStatus("Copied");
								} catch {
									setCopyStatus("Select to copy");
								}
							}}
							aria-live="polite"
						>
							{copyStatus}
						</button>
					</div>
				</section>
				<WorkflowDemo />
				<section
					className={styles.explanation}
					aria-label="Work with your existing tools"
				>
					<div className={styles.story}>
						<section>
							<h2>Leave work as it is</h2>
							<p>
								Start another task in its own directory. Your uncommitted
								changes stay right where you left them.
							</p>
							<code>gji new feature/search</code>
						</section>
						<section>
							<h2>Review a PR in its own place</h2>
							<p>
								Open a PR in a separate worktree, then return to your task when
								you’re ready.
							</p>
							<code>gji pr 1234</code>
						</section>
						<section>
							<h2>Pick up where you left off</h2>
							<p>
								Return to your original directory and keep using your usual Git
								commands and editor.
							</p>
							<code>gji back</code>
						</section>
					</div>
					<p className={styles.setup}>
						New worktrees run supported dependency setup automatically. Shell
						integration lets gji move you between directories.{" "}
						<Link to="/docs/installation">Installation and setup</Link>
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
