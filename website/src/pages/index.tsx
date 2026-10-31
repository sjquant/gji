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
				<section className={styles.highlights} aria-label="Why gji">
					<div>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.7"
							aria-hidden="true"
						>
							<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
						</svg>
						<h2>Real directories for real work.</h2>
						<p>
							Each task gets its own worktree, with space to run your project,
							install dependencies, and make changes.
						</p>
					</div>
					<div>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.7"
							aria-hidden="true"
						>
							<path d="M6 3h8l4 4v14H6z M14 3v5h4 M9 13h6 M9 17h6" />
						</svg>
						<h2>Your changes stay right where you left them.</h2>
						<p>
							Uncommitted changes stay in their worktree while you switch tasks
							or review a pull request.
						</p>
					</div>
					<div>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.7"
							aria-hidden="true"
						>
							<circle cx="6" cy="5" r="2" />
							<circle cx="18" cy="5" r="2" />
							<circle cx="6" cy="19" r="2" />
							<path d="M6 7v10 M18 7v2a4 4 0 0 1-4 4H6" />
						</svg>
						<h2>Move between tasks from your terminal.</h2>
						<p>
							Create, review, and return with <code>gji new</code>,{" "}
							<code>gji pr</code>, <code>gji go</code>, and{" "}
							<code>gji back</code>.
						</p>
					</div>
				</section>
				<section
					className={styles.explanation}
					aria-label="Work with your existing tools"
				>
					<div className={styles.story}>
						<section>
							<p className={styles.storyLabel}>01 · Your work in progress</p>
							<h2>Leave work as it is.</h2>
							<p>
								You’re in the middle of a change. There’s no need to commit or
								stash it just to switch tasks.
							</p>
							<pre>
								<code>
									{
										"$ git status --short\n M src/checkout.ts\n M src/checkout.test.ts"
									}
								</code>
							</pre>
						</section>
						<section>
							<p className={styles.storyLabel}>02 · Start another task</p>
							<h2>Give the next task its own place.</h2>
							<p>
								Create a branch and worktree together. gji moves your shell into
								the new directory, ready for the next task.
							</p>
							<pre>
								<code>{"$ gji new feature/search"}</code>
							</pre>
						</section>
						<section>
							<p className={styles.storyLabel}>03 · Review a PR</p>
							<h2>Review without disturbing your work.</h2>
							<p>
								Open a pull request from your repository in a separate worktree.
								Your other tasks stay in their own directories.
							</p>
							<pre>
								<code>{"$ gji pr 1234"}</code>
							</pre>
						</section>
						<section>
							<p className={styles.storyLabel}>
								04 · Pick up where you left off
							</p>
							<h2>Go back to exactly where you were.</h2>
							<p>
								Choose an open task with gji go. The changes you left in that
								worktree are still there.
							</p>
							<pre>
								<code>
									{
										"$ gji go feature/payments\n$ git status --short\n M src/checkout.ts\n M src/checkout.test.ts"
									}
								</code>
							</pre>
							<p className={styles.storyAside}>
								Use <code>gji go</code> to choose an open task, or{" "}
								<code>gji back</code> to return to the previous worktree.
							</p>
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
