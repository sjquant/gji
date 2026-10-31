import clsx from "clsx";
import { useEffect, useState } from "react";
import styles from "./WorkflowDemo.module.css";
import scenes from "./workflow-scenes.json";

const workspaces = ["feature/payments", "feature/search", "PR #1234"];

export default function WorkflowDemo() {
	const [step, setStep] = useState(0);
	const [motion, setMotion] = useState(false);
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const [hidden, setHidden] = useState(false);
	const [typed, setTyped] = useState(scenes[0].command.length);
	const scene = scenes[step];
	const paused = hovered || focused || hidden;
	const typing = motion && typed < scene.command.length;

	useEffect(() => {
		const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
		const onPreference = () => setMotion(!preference.matches);
		const onVisibility = () => setHidden(document.hidden);
		onPreference();
		onVisibility();
		preference.addEventListener("change", onPreference);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			preference.removeEventListener("change", onPreference);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, []);

	useEffect(() => {
		setTyped(motion && !focused ? 0 : scene.command.length);
	}, [motion, scene.command, focused]);

	useEffect(() => {
		if (!typing || paused) return;
		const startedAt = performance.now();
		const timer = window.setTimeout(() => {
			const characters = Math.max(
				1,
				Math.floor((performance.now() - startedAt) / 22),
			);
			setTyped(typed + characters);
		}, 22);
		return () => window.clearTimeout(timer);
	}, [typing, paused, typed]);

	useEffect(() => {
		if (!motion || paused || typing) return;
		const timer = window.setTimeout(
			() => setStep((step + 1) % scenes.length),
			1000,
		);
		return () => window.clearTimeout(timer);
	}, [motion, paused, typing, step]);

	return (
		<section
			id="workflow"
			tabIndex={-1}
			className={styles.demo}
			aria-label="See how work stays in separate worktrees"
			aria-describedby="workflow-help"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocusCapture={(event) => {
				if (event.target !== event.currentTarget) setFocused(true);
			}}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget))
					setFocused(false);
			}}
		>
			<fieldset className={styles.steps} aria-label="Choose a workflow scene">
				{scenes.map((item, index) => (
					<button
						key={item.label}
						type="button"
						aria-pressed={step === index}
						onClick={() => {
							setStep(index);
							setTyped(item.command.length);
						}}
					>
						<span aria-hidden="true">0{index + 1} · </span>
						{item.label}
					</button>
				))}
				<span
					className={styles.indicator}
					aria-hidden="true"
					style={{ transform: `translateX(${step * 100}%)` }}
				/>
			</fieldset>
			<div className={styles.terminal}>
				<pre key={scene.label} className={styles.screen} aria-hidden="true">
					<code>
						<span className={styles.prompt}>$ </span>
						{renderCommand(
							scene.command.slice(0, motion ? typed : scene.command.length),
						)}
						{typing && <span className={styles.cursor} />}
						{!typing && (
							<>
								{"\n"}
								{scene.lines.map((line) => (
									<span className={styles.outputLine} key={line}>
										{renderOutput(line)}
									</span>
								))}
							</>
						)}
					</code>
				</pre>
				<p
					className={styles.srOnly}
					aria-live={focused || !motion ? "polite" : "off"}
				>
					{scene.command}
					{"\n"}
					{scene.lines.join("\n")}
				</p>
				<div className={styles.workspaces}>
					{workspaces.map((item, index) => (
						<div
							key={item}
							aria-hidden={index >= scene.visible}
							className={clsx(
								styles.workspace,
								index === scene.active && styles.active,
								index >= scene.visible && styles.hidden,
							)}
						>
							<span className={styles.branch}>{item}</span>
						</div>
					))}
				</div>
			</div>
			<p className={styles.note}>Illustrated workflow · setup time omitted</p>
			<p id="workflow-help" className={styles.srOnly}>
				Shell integration is enabled in this example. Hover or focus to pause.
			</p>
			<noscript>
				<pre className={styles.fallback}>
					gji new feature/search{"\n"}gji pr 1234{"\n"}gji go feature/payments
				</pre>
				<p>
					Each task gets its own worktree. Return to feature/payments with your
					edits still there.
				</p>
			</noscript>
		</section>
	);
}

function renderCommand(value: string) {
	return Array.from(value.matchAll(/(\S+)(\s*)/g), (match) => {
		const token = match[1];
		return (
			<span
				key={match.index}
				className={
					match.index === 0
						? styles.executable
						: token.startsWith("-") || /^\d+$/.test(token)
							? styles.argument
							: token.includes("/")
								? styles.filename
								: undefined
				}
			>
				{match[0]}
			</span>
		);
	});
}

function renderOutput(line: string) {
	if (line.startsWith("$ "))
		return (
			<>
				<span className={styles.prompt}>$ </span>
				{renderCommand(line.slice(2))}
			</>
		);
	return (
		<>
			<span className={styles.modified}>{line.slice(0, 3)}</span>
			<span className={styles.output}>{line.slice(3)}</span>
		</>
	);
}
