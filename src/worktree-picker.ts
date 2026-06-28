import { loadHistory } from "./history.js";
import type { WorktreeEntry } from "./repo.js";
import {
	readWorktreeInfos,
	type UpstreamState,
	type WorktreeInfo,
} from "./worktree-info.js";

export interface WorktreePromptSource {
	repoName: string;
	worktree: WorktreeEntry;
}

export interface WorktreePromptEntry extends WorktreeEntry {
	badges: string[];
	group: "current" | "recent" | "other";
	hint: string;
	label: string;
	lastActivityTimestamp: number | null;
	lastActivityType: "used" | "worked" | null;
	repoName: string;
	searchText: string;
}

interface BuildWorktreePromptEntriesOptions {
	query?: string;
	now?: number;
}

export async function buildWorktreePromptEntries(
	sources: WorktreePromptSource[],
	options: BuildWorktreePromptEntriesOptions = {},
): Promise<WorktreePromptEntry[]> {
	const [history, infos] = await Promise.all([
		loadHistory(),
		readWorktreeInfos(sources.map((source) => source.worktree)),
	]);
	const historyByPath = new Map(history.map((entry) => [entry.path, entry]));
	const entries = sources.map((source, index) =>
		buildWorktreePromptEntry(
			source,
			infos[index],
			historyByPath.get(source.worktree.path)?.timestamp ?? null,
			options.now ?? Date.now(),
		),
	);

	return sortAndFilterWorktreePromptEntries(entries, options.query);
}

function buildWorktreePromptEntry(
	source: WorktreePromptSource,
	info: WorktreeInfo,
	lastUsedTimestamp: number | null,
	now: number,
): WorktreePromptEntry {
	const lastWorkedTimestamp =
		info.lastCommitTimestamp === null ? null : info.lastCommitTimestamp * 1000;
	const lastActivityTimestamp = lastUsedTimestamp ?? lastWorkedTimestamp;
	const lastActivityType =
		lastUsedTimestamp !== null
			? "used"
			: lastWorkedTimestamp !== null
				? "worked"
				: null;
	const branch = source.worktree.branch ?? "(detached)";
	const badges = buildStatusBadges(info);
	const recency = formatPromptRecency(
		lastActivityTimestamp,
		lastActivityType,
		now,
	);
	const label = `${middleEllipsize(source.repoName, 22)} › ${middleEllipsize(branch, 34)}`;
	const hint = [
		badges.length > 0 ? badges.map((badge) => `[${badge}]`).join(" ") : null,
		recency,
		middleEllipsize(source.worktree.path, 76),
	]
		.filter((part): part is string => part !== null && part.length > 0)
		.join(" · ");

	return {
		...source.worktree,
		badges,
		group: source.worktree.isCurrent
			? "current"
			: lastUsedTimestamp !== null
				? "recent"
				: "other",
		hint,
		label,
		lastActivityTimestamp,
		lastActivityType,
		repoName: source.repoName,
		searchText: buildSearchText(source.repoName, source.worktree),
	};
}

function buildStatusBadges(info: WorktreeInfo): string[] {
	const badges: string[] = [];

	if (info.isCurrent) {
		badges.push("current");
	}

	if (info.branch === null) {
		badges.push("detached");
	}

	if (info.status === "dirty") {
		badges.push("dirty");
	}

	if (info.upstream.kind === "stale") {
		badges.push("stale", "gone");
	}

	if (isUpToDate(info.upstream)) {
		badges.push("up to date");
	}

	return badges;
}

function isUpToDate(upstream: UpstreamState): boolean {
	return (
		upstream.kind === "tracked" && upstream.ahead === 0 && upstream.behind === 0
	);
}

function formatPromptRecency(
	timestamp: number | null,
	type: WorktreePromptEntry["lastActivityType"],
	now: number,
): string {
	if (timestamp === null || type === null) {
		return "last used: never";
	}

	const label = type === "used" ? "last used" : "last worked";
	return `${label}: ${formatPickerAge(timestamp, now)}`;
}

export function formatPickerAge(
	timestamp: number,
	now: number = Date.now(),
): string {
	const ageSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));

	if (ageSeconds < 60) {
		return "now";
	}

	if (ageSeconds < 60 * 60) {
		return `${Math.floor(ageSeconds / 60)}m ago`;
	}

	if (ageSeconds < 24 * 60 * 60) {
		return `${Math.floor(ageSeconds / (60 * 60))}h ago`;
	}

	if (isYesterday(timestamp, now)) {
		return "yesterday";
	}

	return new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		month: "short",
	}).format(new Date(timestamp));
}

function isYesterday(timestamp: number, now: number): boolean {
	const date = new Date(timestamp);
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);

	return (
		date.getFullYear() === yesterday.getFullYear() &&
		date.getMonth() === yesterday.getMonth() &&
		date.getDate() === yesterday.getDate()
	);
}

function buildSearchText(repoName: string, worktree: WorktreeEntry): string {
	return [
		repoName,
		worktree.branch ?? "detached",
		worktree.path,
		`${repoName}/${worktree.branch ?? "detached"}`,
	]
		.join(" ")
		.toLowerCase();
}

export function sortAndFilterWorktreePromptEntries(
	entries: WorktreePromptEntry[],
	query?: string,
): WorktreePromptEntry[] {
	const normalizedQuery = query?.trim().toLowerCase();
	const scoredEntries = entries
		.map((entry) => ({
			entry,
			score: normalizedQuery ? scoreWorktreeMatch(entry, normalizedQuery) : 0,
		}))
		.filter(({ score }) => normalizedQuery === undefined || score !== null);

	return scoredEntries
		.sort((a, b) => comparePromptEntries(a, b, normalizedQuery !== undefined))
		.map(({ entry }) => entry);
}

function comparePromptEntries(
	a: { entry: WorktreePromptEntry; score: number | null },
	b: { entry: WorktreePromptEntry; score: number | null },
	hasQuery: boolean,
): number {
	if (a.entry.isCurrent && !b.entry.isCurrent) return -1;
	if (!a.entry.isCurrent && b.entry.isCurrent) return 1;

	if (hasQuery && a.score !== b.score) {
		return (b.score ?? 0) - (a.score ?? 0);
	}

	if (a.entry.group !== b.entry.group) {
		return groupRank(a.entry.group) - groupRank(b.entry.group);
	}

	const aRecent = a.entry.lastActivityTimestamp ?? 0;
	const bRecent = b.entry.lastActivityTimestamp ?? 0;
	if (aRecent !== bRecent) {
		return bRecent - aRecent;
	}

	return (
		a.entry.repoName.localeCompare(b.entry.repoName) ||
		(a.entry.branch ?? "").localeCompare(b.entry.branch ?? "") ||
		a.entry.path.localeCompare(b.entry.path)
	);
}

function groupRank(group: WorktreePromptEntry["group"]): number {
	if (group === "current") return 0;
	if (group === "recent") return 1;
	return 2;
}

function scoreWorktreeMatch(
	entry: WorktreePromptEntry,
	query: string,
): number | null {
	const branch = entry.branch ?? "detached";
	const exactCandidates = [
		branch,
		entry.path,
		entry.repoName,
		`${entry.repoName}/${branch}`,
	].map((candidate) => candidate.toLowerCase());

	if (exactCandidates.includes(query)) {
		return 1000;
	}

	const tokens = query.split(/\s+/).filter(Boolean);
	if (tokens.length === 0) {
		return null;
	}

	let score = 0;
	for (const token of tokens) {
		const index = entry.searchText.indexOf(token);
		if (index === -1) {
			return null;
		}
		score += Math.max(1, 200 - index);
	}

	return score;
}

function middleEllipsize(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	if (maxLength <= 1) {
		return "…";
	}

	const keep = maxLength - 1;
	const start = Math.ceil(keep / 2);
	const end = Math.floor(keep / 2);

	return `${value.slice(0, start)}…${value.slice(value.length - end)}`;
}
