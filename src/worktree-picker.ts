import { stdin, stdout } from "node:process";
import { emitKeypressEvents } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { loadHistory } from "./history.js";
import type { WorktreeEntry } from "./repo.js";
import {
	readWorktreeInfos,
	type UpstreamState,
	type WorktreeInfo,
} from "./worktree-info.js";

export const DEFAULT_WORKTREE_SORT: WorktreeSort = "current-first";

export type WorktreeSort = "current-first" | "recent-first";

export interface WorktreePromptSource {
	repoName: string;
	worktree: WorktreeEntry;
}

export interface WorktreePromptEntry extends WorktreeEntry {
	group: "recent" | "other";
	label: string;
	repoName: string;
}

export interface WorktreePickerIO {
	input?: Readable & {
		isTTY?: boolean;
		setRawMode?: (mode: boolean) => void;
	};
	output?: Writable & {
		columns?: number;
		rows?: number;
	};
}

interface SortableWorktreePromptEntry extends WorktreePromptEntry {
	lastActivityTimestamp: number | null;
}

export interface WorktreePromptEntryOptions {
	sort?: WorktreeSort;
}

export async function buildWorktreePromptEntries(
	sources: WorktreePromptSource[],
	options: WorktreePromptEntryOptions = {},
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
			Date.now(),
		),
	);

	return entries
		.sort((left, right) =>
			comparePromptEntries(left, right, options.sort ?? DEFAULT_WORKTREE_SORT),
		)
		.map(
			({ lastActivityTimestamp: _lastActivityTimestamp, ...entry }) => entry,
		);
}

export function resolveWorktreeSort(value: unknown): WorktreeSort {
	return value === "recent-first" || value === "current-first"
		? value
		: DEFAULT_WORKTREE_SORT;
}

export function resolveWorktreeQuery(
	sources: WorktreePromptSource[],
	query: string,
): WorktreePromptSource | null {
	const normalizedQuery = normalizeQuery(query);
	if (normalizedQuery === null) return null;

	const matches = findWorktreePromptSourceMatches(sources, normalizedQuery);
	if (isAmbiguousRepoOnlyQuery(matches, normalizedQuery)) return null;

	return matches[0]?.source ?? null;
}

function findWorktreePromptSourceMatches(
	sources: WorktreePromptSource[],
	normalizedQuery: string,
): { matchScore: number; source: WorktreePromptSource }[] {
	return sources
		.flatMap((source) => {
			const matchScore = scoreWorktreeMatch(
				{
					...source.worktree,
					repoName: source.repoName,
				},
				normalizedQuery,
			);

			return matchScore === null ? [] : [{ matchScore, source }];
		})
		.sort(compareQueryMatches);
}

function isAmbiguousRepoOnlyQuery(
	matches: { matchScore: number; source: WorktreePromptSource }[],
	query: string,
): boolean {
	if (matches[0]?.matchScore === 1000) return false;

	return (
		matches.filter((match) => match.source.repoName.toLowerCase() === query)
			.length > 1
	);
}

export async function promptForSingleWorktree(
	message: string,
	worktrees: WorktreePromptEntry[],
	io: WorktreePickerIO = {},
): Promise<string | null> {
	const choice = await runSearchablePrompt<string>({
		entries: worktrees.map((worktree) => ({
			label: worktree.label,
			searchText: buildPromptSearchText(worktree),
			value: worktree.path,
		})),
		input: io.input,
		message,
		multiple: false,
		output: io.output,
		required: true,
	});

	return typeof choice === "string" ? choice : null;
}

export async function promptForMultipleWorktrees(
	message: string,
	worktrees: WorktreePromptEntry[],
	io: WorktreePickerIO = {},
): Promise<string[] | null> {
	const choice = await runSearchablePrompt<string>({
		entries: buildGroupedSearchableEntries(worktrees),
		input: io.input,
		message,
		multiple: true,
		output: io.output,
		required: true,
	});

	return Array.isArray(choice) ? choice : null;
}

function compareQueryMatches(
	a: { matchScore: number; source: WorktreePromptSource },
	b: { matchScore: number; source: WorktreePromptSource },
): number {
	if (a.matchScore !== b.matchScore) {
		return b.matchScore - a.matchScore;
	}

	if (a.source.worktree.isCurrent && !b.source.worktree.isCurrent) return -1;
	if (!a.source.worktree.isCurrent && b.source.worktree.isCurrent) return 1;

	return (
		a.source.repoName.localeCompare(b.source.repoName) ||
		(a.source.worktree.branch ?? "").localeCompare(
			b.source.worktree.branch ?? "",
		) ||
		a.source.worktree.path.localeCompare(b.source.worktree.path)
	);
}

function groupPromptEntries(
	worktrees: WorktreePromptEntry[],
): Array<[string, WorktreePromptEntry[]]> {
	const groups = new Map<string, WorktreePromptEntry[]>();

	for (const worktree of worktrees) {
		const group =
			worktree.group === "recent" ? "Recent worktrees" : "Other worktrees";
		groups.set(group, [...(groups.get(group) ?? []), worktree]);
	}

	return [...groups.entries()];
}

function buildGroupedSearchableEntries(
	worktrees: WorktreePromptEntry[],
): SearchablePromptEntry<string>[] {
	const entries: SearchablePromptEntry<string>[] = [];

	for (const [group, groupWorktrees] of groupPromptEntries(worktrees)) {
		entries.push({
			label: group,
			searchText: group.toLowerCase(),
			selectable: false,
			value: group,
		});

		for (const worktree of groupWorktrees) {
			entries.push({
				group,
				label: worktree.label,
				searchText: buildPromptSearchText(worktree),
				selectable: true,
				value: worktree.path,
			});
		}
	}

	return entries;
}

interface SearchablePromptEntry<Value> {
	group?: string;
	label: string;
	searchText: string;
	selectable?: boolean;
	value: Value;
}

type SearchablePromptResult<Value> = Value | Value[] | null;

interface SearchablePromptOptions<Value> extends WorktreePickerIO {
	entries: SearchablePromptEntry<Value>[];
	message: string;
	multiple: boolean;
	required: boolean;
}

async function runSearchablePrompt<Value>(
	options: SearchablePromptOptions<Value>,
): Promise<SearchablePromptResult<Value>> {
	const input = options.input ?? stdin;
	const output = options.output ?? stdout;

	if (!input.isTTY) {
		return null;
	}

	const prompt = new SearchablePrompt(options, input, output);

	return prompt.run();
}

class SearchablePrompt<Value> {
	private cursor = 0;
	private frameLines = 0;
	private query = "";
	private resolve: ((value: SearchablePromptResult<Value>) => void) | undefined;
	private searchActive = false;
	private selected = new Set<Value>();

	constructor(
		private readonly options: SearchablePromptOptions<Value>,
		private readonly input: Readable & {
			isTTY?: boolean;
			setRawMode?: (mode: boolean) => void;
		},
		private readonly output: Writable & {
			columns?: number;
			rows?: number;
		},
	) {}

	run(): Promise<SearchablePromptResult<Value>> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.start();
		});
	}

	private start(): void {
		emitKeypressEvents(this.input);
		this.input.setRawMode?.(true);
		this.output.write("\x1b[?25l");
		this.input.on("keypress", this.handleKeypress);
		this.render();
	}

	private handleKeypress = (
		character: string | undefined,
		key?: { ctrl?: boolean; name?: string },
	): void => {
		if (key?.ctrl && key.name === "c") {
			this.finish(null);
			return;
		}

		if (key?.name === "escape") {
			this.handleEscape();
			return;
		}

		if (this.searchActive && this.handleSearchKey(character, key?.name)) {
			this.render();
			return;
		}

		if (character === "/" && !this.searchActive) {
			this.searchActive = true;
			this.query = "";
			this.cursor = this.firstSelectableIndex();
			this.render();
			return;
		}

		this.handleNavigationKey(character, key?.name);
		this.render();
	};

	private handleEscape(): void {
		if (this.searchActive || this.query.length > 0) {
			this.searchActive = false;
			this.query = "";
			this.cursor = this.firstSelectableIndex();
			this.render();
			return;
		}

		this.finish(null);
	}

	private handleSearchKey(
		character: string | undefined,
		keyName?: string,
	): boolean {
		if (keyName === "space" || character === " ") {
			return false;
		}

		if (keyName === "backspace" || keyName === "delete") {
			this.query = this.query.slice(0, -1);
			this.cursor = this.firstSelectableIndex();
			return true;
		}

		if (isPrintableSearchCharacter(character)) {
			this.query += character;
			this.cursor = this.firstSelectableIndex();
			return true;
		}

		return false;
	}

	private handleNavigationKey(
		character: string | undefined,
		keyName?: string,
	): void {
		switch (keyName) {
			case "up":
				this.moveCursor(-1);
				return;
			case "down":
				this.moveCursor(1);
				return;
			case "return":
				this.submit();
				return;
			case "space":
				this.toggleSelection();
				return;
		}

		switch (character) {
			case "k":
				this.moveCursor(-1);
				return;
			case "j":
				this.moveCursor(1);
				return;
			case " ":
				this.toggleSelection();
				return;
		}
	}

	private moveCursor(direction: -1 | 1): void {
		const entries = this.visibleEntries();
		if (entries.length === 0) return;

		let nextCursor = this.cursor;
		for (let index = 0; index < entries.length; index += 1) {
			nextCursor = wrapIndex(nextCursor + direction, entries.length);
			if (isSelectableEntry(entries[nextCursor])) {
				this.cursor = nextCursor;
				return;
			}
		}
	}

	private submit(): void {
		const entry = this.visibleEntries()[this.cursor];

		if (!this.options.multiple) {
			this.finish(isSelectableEntry(entry) ? entry.value : null);
			return;
		}

		if (this.options.required && this.selected.size === 0) {
			return;
		}

		this.finish([...this.selected]);
	}

	private toggleSelection(): void {
		if (!this.options.multiple) return;

		const entry = this.visibleEntries()[this.cursor];
		if (!isSelectableEntry(entry)) return;

		if (this.selected.has(entry.value)) {
			this.selected.delete(entry.value);
			return;
		}

		this.selected.add(entry.value);
	}

	private render(): void {
		const frame = this.buildFrame();
		if (this.frameLines > 0) {
			this.output.write(`\x1b[${this.frameLines}A\r\x1b[J`);
		}
		this.output.write(frame);
		this.frameLines = frame.split("\n").length - 1;
	}

	private buildFrame(): string {
		const entries = this.visibleEntries();
		const visibleEntries = windowPromptEntries(
			entries,
			this.cursor,
			this.maxItems(),
		);
		const search =
			this.searchActive || this.query.length > 0 ? ` /${this.query}` : "";
		const lines = [
			"|",
			`?  ${this.options.message}${search}`,
			"|",
			...this.renderEntries(visibleEntries),
			"|",
			`-  ${this.footerText(entries.length)}`,
		];

		return `${lines.join("\n")}\n`;
	}

	private renderEntries(
		entries: Array<SearchablePromptEntry<Value> | "ellipsis">,
	): string[] {
		if (this.visibleEntries().length === 0) {
			return ["|  No matching worktrees"];
		}

		return entries.map((entry) =>
			entry === "ellipsis" ? "|  ..." : this.renderEntry(entry),
		);
	}

	private renderEntry(entry: SearchablePromptEntry<Value>): string {
		const entries = this.visibleEntries();
		const active = entries[this.cursor] === entry;
		const selected = this.selected.has(entry.value);
		const prefix = this.entryPrefix(entry, active, selected);

		return `|  ${prefix} ${entry.label}`;
	}

	private entryPrefix(
		entry: SearchablePromptEntry<Value>,
		active: boolean,
		selected: boolean,
	): string {
		if (!isSelectableEntry(entry)) {
			return active ? ">" : " ";
		}

		if (!this.options.multiple) {
			return active ? ">" : " ";
		}

		if (active && selected) return "[x]";
		if (active) return "[ ]";
		return selected ? "[x]" : "[ ]";
	}

	private footerText(visibleCount: number): string {
		if (this.searchActive) {
			return "type to filter, esc to clear, enter to choose";
		}

		const searchHint = "press / to search";
		if (!this.options.multiple) return searchHint;

		const selected = `${this.selected.size} selected`;
		return `${searchHint}, space to toggle, ${selected}, ${visibleCount} shown`;
	}

	private finish(value: SearchablePromptResult<Value>): void {
		this.input.off("keypress", this.handleKeypress);
		this.input.setRawMode?.(false);
		this.output.write("\x1b[?25h");
		this.output.write("\n");
		this.resolve?.(value);
	}

	private firstSelectableIndex(): number {
		const index = this.visibleEntries().findIndex(isSelectableEntry);

		return index === -1 ? 0 : index;
	}

	private visibleEntries(): SearchablePromptEntry<Value>[] {
		const query = normalizeQuery(this.query);
		if (query === null) {
			return this.options.entries;
		}

		return filterSearchablePromptEntries(this.options.entries, query);
	}

	private maxItems(): number {
		const rows = this.output.rows ?? 16;
		return Math.max(5, Math.min(12, rows - 6));
	}
}

function isPrintableSearchCharacter(
	character: string | undefined,
): character is string {
	return (
		typeof character === "string" &&
		character.length === 1 &&
		character >= " " &&
		character !== "\u007f"
	);
}

function wrapIndex(index: number, length: number): number {
	return (index + length) % length;
}

function windowPromptEntries<Value>(
	entries: SearchablePromptEntry<Value>[],
	cursor: number,
	maxItems: number,
): Array<SearchablePromptEntry<Value> | "ellipsis"> {
	if (entries.length <= maxItems) {
		return entries;
	}

	const activeIndex = Math.min(Math.max(cursor, 0), entries.length - 1);
	const start = Math.max(
		0,
		Math.min(activeIndex - 2, entries.length - maxItems),
	);
	const window = entries.slice(start, start + maxItems);

	if (start > 0) {
		window[0] = "ellipsis" as never;
	}

	if (start + maxItems < entries.length) {
		window[window.length - 1] = "ellipsis" as never;
	}

	return window;
}

function filterSearchablePromptEntries<Value>(
	entries: SearchablePromptEntry<Value>[],
	query: string,
): SearchablePromptEntry<Value>[] {
	const filtered: SearchablePromptEntry<Value>[] = [];
	let pendingGroup: SearchablePromptEntry<Value> | null = null;

	for (const entry of entries) {
		if (!isSelectableEntry(entry)) {
			pendingGroup = entry;
			continue;
		}

		if (!entry.searchText.includes(query)) {
			continue;
		}

		if (pendingGroup !== null) {
			filtered.push(pendingGroup);
			pendingGroup = null;
		}

		filtered.push(entry);
	}

	return filtered;
}

function isSelectableEntry<Value>(
	entry: SearchablePromptEntry<Value> | undefined,
): entry is SearchablePromptEntry<Value> {
	return entry !== undefined && entry.selectable !== false;
}

function buildPromptSearchText(worktree: WorktreePromptEntry): string {
	return [
		worktree.repoName,
		worktree.branch ?? "detached",
		worktree.path,
		worktree.label,
		`${worktree.repoName}/${worktree.branch ?? "detached"}`,
	]
		.join(" ")
		.toLowerCase();
}

function buildWorktreePromptEntry(
	source: WorktreePromptSource,
	info: WorktreeInfo,
	lastUsedTimestamp: number | null,
	now: number,
): SortableWorktreePromptEntry {
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
	const status =
		badges.length > 0 ? badges.map((badge) => `[${badge}]`).join(" ") : null;
	const path = middleEllipsize(source.worktree.path, 76);
	const label = [
		middleEllipsize(source.repoName, 22),
		middleEllipsize(branch, 34),
		status,
		recency,
		path,
	]
		.filter((part): part is string => part !== null && part.length > 0)
		.join(" · ");
	return {
		...source.worktree,
		group: lastUsedTimestamp !== null ? "recent" : "other",
		label,
		lastActivityTimestamp,
		repoName: source.repoName,
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
	type: "used" | "worked" | null,
	now: number,
): string {
	if (timestamp === null || type === null) {
		return "last used: never";
	}

	const label = type === "used" ? "last used" : "last worked";
	return `${label}: ${formatPickerAge(timestamp, now)}`;
}

function formatPickerAge(timestamp: number, now: number): string {
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

function buildSearchText(
	repoName: string,
	worktree: Pick<WorktreeEntry, "branch" | "path">,
): string {
	return [
		repoName,
		worktree.branch ?? "detached",
		worktree.path,
		`${repoName}/${worktree.branch ?? "detached"}`,
	]
		.join(" ")
		.toLowerCase();
}

function normalizeQuery(query?: string): string | null {
	const normalized = query?.trim().toLowerCase();
	return normalized && normalized.length > 0 ? normalized : null;
}

function comparePromptEntries(
	a: SortableWorktreePromptEntry,
	b: SortableWorktreePromptEntry,
	sort: WorktreeSort,
): number {
	if (sort === "current-first") {
		if (a.isCurrent && !b.isCurrent) return -1;
		if (!a.isCurrent && b.isCurrent) return 1;
	}

	if (a.group !== b.group) {
		return groupRank(a.group) - groupRank(b.group);
	}

	const aRecent = a.lastActivityTimestamp ?? 0;
	const bRecent = b.lastActivityTimestamp ?? 0;
	if (aRecent !== bRecent) {
		return bRecent - aRecent;
	}

	if (sort === "recent-first") {
		if (a.isCurrent && !b.isCurrent) return -1;
		if (!a.isCurrent && b.isCurrent) return 1;
	}

	return (
		a.repoName.localeCompare(b.repoName) ||
		(a.branch ?? "").localeCompare(b.branch ?? "") ||
		a.path.localeCompare(b.path)
	);
}

function groupRank(group: WorktreePromptEntry["group"]): number {
	return group === "recent" ? 0 : 1;
}

function scoreWorktreeMatch(
	entry: Pick<WorktreePromptEntry, "branch" | "path" | "repoName">,
	query: string,
): number | null {
	const branch = entry.branch ?? "detached";
	const exactCandidates = [
		branch,
		entry.path,
		`${entry.repoName}/${branch}`,
	].map((candidate) => candidate.toLowerCase());

	if (exactCandidates.includes(query)) {
		return 1000;
	}

	return buildSearchText(entry.repoName, entry).includes(query) ? 1 : null;
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
