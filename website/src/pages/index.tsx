import Head from "@docusaurus/Head";
import Link from "@docusaurus/Link";
import Translate, { translate } from "@docusaurus/Translate";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import { type ReactNode, useState } from "react";

import Seo from "../components/Seo";
import WorkflowDemo from "../components/WorkflowDemo";
import styles from "./index.module.css";

const title = translate({
	id: "home.title",
	message: "Switch tasks. Keep your place.",
});
const description = translate({
	id: "home.description",
	message:
		"Open a new task or review a PR. Your current work stays right where you left it. gji makes Git worktrees part of your everyday shell workflow.",
});

export default function Home(): ReactNode {
	const [copyStatus, setCopyStatus] = useState(
		translate({ id: "home.copy", message: "Copy" }),
	);
	const { siteConfig } = useDocusaurusContext();
	return (
		<Layout title={title} description={description}>
			<Head>
				<meta property="og:type" content="website" />
			</Head>
			<Seo
				title={title}
				description={description}
				permalink={siteConfig.baseUrl}
			/>
			<main className={styles.page}>
				<section className={styles.hero}>
					<p className={styles.eyebrow}>
						<Translate id="home.text01">{"Git worktree CLI"}</Translate>
					</p>
					<h1>
						<Translate id="home.text02">{"Switch tasks."}</Translate>
						<br />
						<Translate id="home.text03">{"Keep your place."}</Translate>
					</h1>
					<p className={styles.lead}>
						<Translate id="home.text04">
							{"Open a new task or review a PR."}
						</Translate>
						<br />
						<Translate id="home.text05">
							{" Your current work stays right where you left it."}
						</Translate>
					</p>
					<div className={styles.actions}>
						<Link className={styles.primary} to="/docs/quick-start">
							<Translate id="home.text06">{"Quick start"}</Translate>
						</Link>
						<a className={styles.secondary} href="#workflow">
							<Translate id="home.text07">{"See the workflow "}</Translate>
							<span aria-hidden="true">↓</span>
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
									setCopyStatus(
										translate({ id: "home.copied", message: "Copied" }),
									);
								} catch {
									setCopyStatus(
										translate({
											id: "home.copyFallback",
											message: "Select to copy",
										}),
									);
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
					className={styles.highlights}
					aria-label={translate({ id: "home.why", message: "Why gji" })}
				>
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
						<h2>
							<Translate id="home.text08">
								{"Real directories for real work."}
							</Translate>
						</h2>
						<p>
							<Translate id="home.text09">
								{
									"Each task gets its own worktree, with space to run your project, install dependencies, and make changes."
								}
							</Translate>
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
						<h2>
							<Translate id="home.text10">
								{"Your changes stay right where you left them."}
							</Translate>
						</h2>
						<p>
							<Translate id="home.text11">
								{
									"Uncommitted changes stay in their worktree while you switch tasks or review a pull request."
								}
							</Translate>
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
						<h2>
							<Translate id="home.text12">
								{"Move between tasks from your terminal."}
							</Translate>
						</h2>
						<p>
							<Translate id="home.text13">
								{"Create, review, and return with "}
							</Translate>
							<code>gji new</code>, <code>gji pr</code>, <code>gji go</code>
							<Translate id="home.text14">{", and"}</Translate>{" "}
							<code>gji back</code>.
						</p>
					</div>
				</section>
				<section
					className={styles.explanation}
					aria-label={translate({
						id: "home.tools",
						message: "Work with your existing tools",
					})}
				>
					<div className={styles.story}>
						<section>
							<p className={styles.storyLabel}>
								<Translate id="home.text15">
									{"01 · Your work in progress"}
								</Translate>
							</p>
							<h2>
								<Translate id="home.text16">{"Leave work as it is."}</Translate>
							</h2>
							<p>
								<Translate id="home.text17">
									{
										"You’re in the middle of a change. There’s no need to commit or stash it just to switch tasks."
									}
								</Translate>
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
							<p className={styles.storyLabel}>
								<Translate id="home.text18">
									{"02 · Start another task"}
								</Translate>
							</p>
							<h2>
								<Translate id="home.text19">
									{"Give the next task its own place."}
								</Translate>
							</h2>
							<p>
								<Translate id="home.text20">
									{
										"Create a branch and worktree together. gji moves your shell into the new directory, ready for the next task."
									}
								</Translate>
							</p>
							<pre>
								<code>{"$ gji new feature/search"}</code>
							</pre>
						</section>
						<section>
							<p className={styles.storyLabel}>
								<Translate id="home.text21">{"03 · Review a PR"}</Translate>
							</p>
							<h2>
								<Translate id="home.text22">
									{"Review without disturbing your work."}
								</Translate>
							</h2>
							<p>
								<Translate id="home.text23">
									{
										"Open a pull request from your repository in a separate worktree. Your other tasks stay in their own directories."
									}
								</Translate>
							</p>
							<pre>
								<code>{"$ gji pr 1234"}</code>
							</pre>
						</section>
						<section>
							<p className={styles.storyLabel}>
								<Translate id="home.text24">
									{"04 · Move between tasks"}
								</Translate>
							</p>
							<h2>
								<Translate id="home.text25">
									{"Go to the task you need."}
								</Translate>
							</h2>
							<p>
								<Translate id="home.text26">
									{
										"Choose an open task with gji go, or name the branch you want. Your changes remain in that worktree."
									}
								</Translate>
							</p>
							<pre>
								<code>
									{
										"$ gji go feature/payments\n$ git status --short\n M src/checkout.ts\n M src/checkout.test.ts"
									}
								</code>
							</pre>
						</section>
						<section>
							<p className={styles.storyLabel}>
								<Translate id="home.text27">
									{"05 · Return to your last task"}
								</Translate>
							</p>
							<h2>
								<Translate id="home.text28">
									{"Go back in one command."}
								</Translate>
							</h2>
							<p>
								<Translate id="home.text29">
									{
										"Return to the previous worktree with gji back. In this example, that takes you back to the PR you were reviewing."
									}
								</Translate>
							</p>
							<pre>
								<code>{"$ gji back"}</code>
							</pre>
						</section>
					</div>
					<p className={styles.setup}>
						<Translate id="home.text30">
							{
								"New worktrees run supported dependency setup automatically. Shell integration lets gji move you between directories."
							}
						</Translate>{" "}
						<Link to="/docs/installation">
							<Translate id="home.text31">{"Installation and setup"}</Translate>
						</Link>
					</p>
					<div className={styles.referenceLinks}>
						<Link className={styles.primary} to="/docs/quick-start">
							<Translate id="home.text32">{"Quick start"}</Translate>
						</Link>
						<Link className={styles.secondary} to="/docs/commands">
							<Translate id="home.text33">{"Command reference"}</Translate>
						</Link>
					</div>
				</section>
			</main>
		</Layout>
	);
}
