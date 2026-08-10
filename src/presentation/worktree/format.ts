import type { UpstreamState } from "../../application/worktree/read-models.js";

export function formatUpstreamState(upstream: UpstreamState): string {
	if (upstream.kind === "detached") return "n/a";
	if (upstream.kind === "no-upstream") return "no-upstream";
	if (upstream.kind === "stale") return "gone";
	if (upstream.kind === "unknown") return "unknown";
	return formatAheadBehind(upstream.ahead, upstream.behind);
}

function formatAheadBehind(ahead: number, behind: number): string {
	if (ahead === 0 && behind === 0) return "up to date";
	if (ahead === 0) return `behind ${behind}`;
	if (behind === 0) return `ahead ${ahead}`;
	return `ahead ${ahead}, behind ${behind}`;
}

export function formatLastCommit(timestampSeconds: number | null): string {
	return timestampSeconds === null
		? "n/a"
		: formatRelativeAge(timestampSeconds);
}

export function formatRelativeAge(
	timestampSeconds: number,
	nowSeconds = Math.floor(Date.now() / 1000),
): string {
	const ageSeconds = Math.max(0, nowSeconds - timestampSeconds);
	const units = [
		{ label: "y", seconds: 365 * 24 * 60 * 60 },
		{ label: "mo", seconds: 30 * 24 * 60 * 60 },
		{ label: "d", seconds: 24 * 60 * 60 },
		{ label: "h", seconds: 60 * 60 },
		{ label: "m", seconds: 60 },
	];

	for (const unit of units) {
		const value = Math.floor(ageSeconds / unit.seconds);
		if (value > 0) return `${value}${unit.label} ago`;
	}

	return "just now";
}
