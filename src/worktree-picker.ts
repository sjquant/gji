import { env, platform, stdin, stdout } from "node:process";
import type { Readable, Writable } from "node:stream";

import { isCancel, Prompt } from "@clack/core";

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

export async function buildWorktreePromptEntries(
	sources: WorktreePromptSource[],
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
		.sort(comparePromptEntries)
		.map(
			({ lastActivityTimestamp: _lastActivityTimestamp, ...entry }) => entry,
		);
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
	const choice = await runSearchablePrompt({
		entries: worktrees.map(buildSearchableWorktreeEntry),
		input: io.input,
		message,
		multiple: false,
		output: io.output,
	});

	return typeof choice === "string" ? choice : null;
}

export async function promptForMultipleWorktrees(
	message: string,
	worktrees: WorktreePromptEntry[],
	io: WorktreePickerIO = {},
): Promise<string[] | null> {
	const choice = await runSearchablePrompt({
		entries: buildGroupedSearchableEntries(worktrees),
		input: io.input,
		message,
		multiple: true,
		output: io.output,
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
		const groupWorktrees = groups.get(group);
		if (groupWorktrees === undefined) {
			groups.set(group, [worktree]);
		} else {
			groupWorktrees.push(worktree);
		}
	}

	return [...groups.entries()];
}

function buildGroupedSearchableEntries(
	worktrees: WorktreePromptEntry[],
): SearchablePromptEntry[] {
	const entries: SearchablePromptEntry[] = [];

	for (const [group, groupWorktrees] of groupPromptEntries(worktrees)) {
		entries.push({
			label: group,
			searchText: group.toLowerCase(),
			selectable: false,
		});

		for (const worktree of groupWorktrees) {
			entries.push(buildSearchableWorktreeEntry(worktree));
		}
	}

	return entries;
}

function buildSearchableWorktreeEntry(
	worktree: WorktreePromptEntry,
): SearchablePromptEntry {
	const metadata = parsePromptLabelMetadata(worktree.label);
	const branch = worktree.branch ?? "(detached)";

	return {
		detail: [worktree.repoName, branch, metadata, worktree.path]
			.filter((part): part is string => part !== null && part.length > 0)
			.join(" · "),
		label: worktree.label,
		searchText: buildPromptSearchText(worktree),
		value: worktree.path,
		worktree: {
			branch,
			metadata,
			path: worktree.path,
			repoName: worktree.repoName,
		},
	};
}

function parsePromptLabelMetadata(label: string): string | null {
	const parts = label.split(" · ");
	if (parts.length <= 3) return null;

	return parts.slice(2, -1).join(" · ");
}

interface SearchablePromptEntry {
	detail?: string;
	label: string;
	searchText: string;
	selectable?: boolean;
	value?: string;
	worktree?: {
		branch: string;
		metadata: string | null;
		path: string;
		repoName: string;
	};
}

type SearchablePromptResult = string | string[] | null;
type WorktreePromptAction =
	| "up"
	| "down"
	| "space"
	| "enter"
	| "escape"
	| "cancel";

interface SearchablePromptOptions extends WorktreePickerIO {
	entries: SearchablePromptEntry[];
	message: string;
	multiple: boolean;
}

interface PromptGlyphs {
	active: string;
	bar: string;
	checked: string;
	corner: string;
	inactive: string;
	pending: string;
	submitted: string;
	unchecked: string;
	uncheckedActive: string;
}

interface PromptColors {
	activeBar: (value: string) => string;
	bar: (value: string) => string;
	error: (value: string) => string;
	errorBar: (value: string) => string;
	hint: (value: string) => string;
	key: (value: string) => string;
	option: (value: string) => string;
	search: (value: string) => string;
	selected: (value: string) => string;
	symbol: (value: string, state: string) => string;
}

interface PromptPiece {
	ellipsize: (value: string, maxLength: number) => string;
	max: number;
	min: number;
	value: string;
}

async function runSearchablePrompt(
	options: SearchablePromptOptions,
): Promise<SearchablePromptResult> {
	const input = options.input ?? stdin;
	const output = options.output ?? stdout;

	if (!input.isTTY) {
		return null;
	}

	const prompt = new SearchablePrompt(options, input, output);
	const value = await prompt.run();

	return isCancel(value) ? null : value;
}

class SearchablePrompt {
	private cursor = 0;
	private query = "";
	private searchActive = false;
	private selected = new Set<string>();
	private readonly prompt: WorktreeCorePrompt;

	constructor(
		private readonly options: SearchablePromptOptions,
		input: Readable & {
			isTTY?: boolean;
			setRawMode?: (mode: boolean) => void;
		},
		private readonly output: Writable & {
			columns?: number;
			rows?: number;
		},
	) {
		this.cursor = this.firstSelectableIndex();
		const owner = this;
		this.prompt = new WorktreeCorePrompt(this, {
			input,
			output,
			render: function renderWorktreePrompt() {
				return owner.render(this.state, this.error);
			},
		});
		this.syncValue();
	}

	run(): Promise<SearchablePromptResult | symbol> {
		return this.prompt.prompt();
	}

	handleKeypress(
		prompt: WorktreeCorePrompt,
		character: string | undefined,
		key?: { ctrl?: boolean; name?: string; sequence?: string },
	): void {
		if (prompt.state === "error") {
			prompt.state = "active";
			prompt.error = "";
		}

		const action = resolvePromptAction(character, key);
		if (action === "cancel") {
			this.cancel(prompt);
			return;
		}

		if (action === "escape") {
			this.handleEscapeKey(prompt);
			return;
		}

		if (action === "enter") {
			this.submit(prompt);
			return;
		}

		if (this.searchActive && this.handleSearchKey(character, key?.name)) {
			this.syncValue();
			renderPrompt(prompt);
			return;
		}

		if (character === "/" && !this.searchActive) {
			this.searchActive = true;
			this.query = "";
			this.cursor = this.firstSelectableIndex();
			this.syncValue();
			renderPrompt(prompt);
			return;
		}

		this.handleNavigationKey(character, action);
		this.syncValue();
		renderPrompt(prompt);
	}

	private handleEscapeKey(prompt: WorktreeCorePrompt): void {
		if (this.searchActive) {
			this.searchActive = false;
			this.query = "";
			this.cursor = this.firstSelectableIndex();
			this.syncValue();
			renderPrompt(prompt);
			return;
		}

		this.cancel(prompt);
	}

	private cancel(prompt: WorktreeCorePrompt): void {
		prompt.state = "cancel";
		renderPrompt(prompt);
		closePrompt(prompt);
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
		action?: WorktreePromptAction,
	): void {
		switch (action) {
			case "up":
				this.moveCursor(-1);
				return;
			case "down":
				this.moveCursor(1);
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

	private submit(prompt: WorktreeCorePrompt): void {
		const entry = this.visibleEntries()[this.cursor];

		if (!this.options.multiple) {
			prompt.value = isSelectableEntry(entry) ? entry.value : null;
			prompt.state = "submit";
			renderPrompt(prompt);
			closePrompt(prompt);
			return;
		}

		if (this.selected.size === 0) {
			prompt.error = "Please select at least one option.";
			prompt.state = "error";
			renderPrompt(prompt);
			return;
		}

		prompt.value = [...this.selected];
		prompt.state = "submit";
		renderPrompt(prompt);
		closePrompt(prompt);
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

	private render(state: string, error: string): string {
		const entries = this.visibleEntries();
		const visibleEntries = windowPromptEntries(
			entries,
			this.cursor,
			this.maxItems(),
		);
		const glyphs = promptGlyphs();
		const colors = promptColors();
		const frame = promptFrameColor(state, colors);
		const lines = [
			colors.bar(glyphs.bar),
			this.renderTitle(state, glyphs, colors),
			`${frame(glyphs.bar)}  ${this.renderSearchHint(colors)}`,
			frame(glyphs.bar),
		];

		if (state === "error" && error.length > 0) {
			lines.push(`${colors.errorBar(glyphs.bar)}  ${colors.error(error)}`);
			lines.push(frame(glyphs.bar));
		}

		lines.push(
			...this.renderEntries(entries, visibleEntries, glyphs, colors, frame),
		);
		lines.push(frame(glyphs.bar));
		const preview = this.activePreview(entries, colors);
		if (preview !== null) {
			lines.push(`${frame(glyphs.bar)}  ${preview}`);
			lines.push(frame(glyphs.bar));
		}
		const visibleWorktreeCount = entries.filter(isSelectableEntry).length;
		const footer = this.footerText(visibleWorktreeCount, colors);
		if (footer.length > 0) {
			lines.push(`${frame(glyphs.corner)}  ${footer}`);
		}

		return `${lines.join("\n")}\n`;
	}

	private renderTitle(
		state: string,
		glyphs: PromptGlyphs,
		colors: PromptColors,
	): string {
		const symbol = colors.symbol(promptSymbol(state, glyphs), state);
		const maxTitleLength = Math.max(8, this.columns() - 3);
		if (!this.searchActive) {
			return `${symbol}  ${middleEllipsize(this.options.message, maxTitleLength)}`;
		}

		const search = ` /${this.query}`;
		const maxSearchLength = Math.min(
			search.length,
			Math.floor(maxTitleLength / 2),
		);
		const message = middleEllipsize(
			this.options.message,
			Math.max(1, maxTitleLength - maxSearchLength),
		);
		const visibleSearch = middleEllipsize(
			search,
			Math.max(1, maxTitleLength - message.length),
		);

		return `${symbol}  ${message}${colors.search(visibleSearch)}`;
	}

	private renderSearchHint(colors: PromptColors): string {
		if (this.searchActive) {
			return `${colors.hint("type to filter")} ${colors.hint("·")} ${colors.key("esc")} ${colors.hint("clears")}`;
		}

		return `${colors.hint("press ")}${colors.key("/")}${colors.hint(" to search")}`;
	}

	private renderEntries(
		entries: SearchablePromptEntry[],
		visibleEntries: Array<SearchablePromptEntry | "ellipsis">,
		glyphs: PromptGlyphs,
		colors: PromptColors,
		frame: (value: string) => string,
	): string[] {
		if (entries.length === 0) {
			return [`${frame(glyphs.bar)}  ${colors.hint("No matching worktrees")}`];
		}

		return visibleEntries.map((entry) =>
			entry === "ellipsis"
				? `${frame(glyphs.bar)}  ${colors.hint("...")}`
				: this.renderEntry(entries, entry, glyphs, colors, frame),
		);
	}

	private renderEntry(
		entries: SearchablePromptEntry[],
		entry: SearchablePromptEntry,
		glyphs: PromptGlyphs,
		colors: PromptColors,
		frame: (value: string) => string,
	): string {
		const active = entries[this.cursor] === entry;
		const selected = isSelectableEntry(entry) && this.selected.has(entry.value);
		const prefix = this.entryPrefix(entry, active, selected, glyphs);
		const label = this.entryLabel(entry, prefix);
		const line = isSelectableEntry(entry)
			? active
				? label
				: colors.hint(label)
			: colors.hint(label);
		const marker = selected
			? colors.selected(prefix)
			: active
				? this.options.multiple
					? colors.option(prefix)
					: colors.selected(prefix)
				: colors.hint(prefix);

		return `${frame(glyphs.bar)}  ${marker} ${line}`;
	}

	private activePreview(
		entries: SearchablePromptEntry[],
		colors: PromptColors,
	): string | null {
		const entry = entries[this.cursor];
		if (!isSelectableEntry(entry) || entry.detail === undefined) return null;

		const detail = middleEllipsize(entry.detail, this.previewWidth());
		return colors.hint(detail);
	}

	private entryLabel(entry: SearchablePromptEntry, prefix: string): string {
		const width = this.labelWidth(prefix);
		if (entry.worktree === undefined) {
			return middleEllipsize(entry.label, width);
		}

		return fitPromptPieces(
			[
				{
					ellipsize: middleEllipsize,
					max: 18,
					min: 6,
					value: entry.worktree.repoName,
				},
				{
					ellipsize: middleEllipsize,
					max: 32,
					min: 8,
					value: entry.worktree.branch,
				},
				...(entry.worktree.metadata === null
					? []
					: [
							{
								ellipsize: middleEllipsize,
								max: 30,
								min: 10,
								value: entry.worktree.metadata,
							},
						]),
				{
					ellipsize: startEllipsize,
					max: 36,
					min: 12,
					value: entry.worktree.path,
				},
			],
			width,
		);
	}

	private labelWidth(prefix: string): number {
		return Math.max(8, this.columns() - prefix.length - 4);
	}

	private previewWidth(): number {
		return Math.max(8, this.columns() - 3);
	}

	private entryPrefix(
		entry: SearchablePromptEntry,
		active: boolean,
		selected: boolean,
		glyphs: PromptGlyphs,
	): string {
		if (!isSelectableEntry(entry)) {
			return active ? glyphs.active : " ";
		}

		if (!this.options.multiple) {
			return active ? glyphs.active : glyphs.inactive;
		}

		if (active && selected) return glyphs.checked;
		if (active) return glyphs.uncheckedActive;
		return selected ? glyphs.checked : glyphs.unchecked;
	}

	private footerText(visibleCount: number, colors: PromptColors): string {
		if (!this.options.multiple) return "";

		return [
			`${colors.key("space")} ${colors.hint("select")}`,
			`${colors.selected(String(this.selected.size))} ${colors.hint("selected")}`,
			colors.hint(`${visibleCount} shown`),
		].join(colors.hint(" · "));
	}

	private firstSelectableIndex(): number {
		const index = this.visibleEntries().findIndex(isSelectableEntry);

		return index === -1 ? 0 : index;
	}

	private visibleEntries(): SearchablePromptEntry[] {
		const query = normalizeQuery(this.query);
		if (query === null) {
			return this.options.entries;
		}

		return filterSearchablePromptEntries(this.options.entries, query);
	}

	private maxItems(): number {
		const rows = this.output.rows ?? 16;
		return Math.max(5, Math.min(12, rows - 8));
	}

	private columns(): number {
		return Math.max(20, this.output.columns ?? 80);
	}

	private syncValue(): void {
		if (this.options.multiple) {
			this.prompt.value = [...this.selected];
			return;
		}

		const entry = this.visibleEntries()[this.cursor];
		this.prompt.value = isSelectableEntry(entry) ? entry.value : null;
	}
}

class WorktreeCorePrompt extends Prompt {
	constructor(
		readonly worktreePrompt: SearchablePrompt,
		options: ConstructorParameters<typeof Prompt>[0],
	) {
		super(options, false);
	}
}

Object.defineProperty(WorktreeCorePrompt.prototype, "onKeypress", {
	value: function onWorktreeKeypress(
		this: WorktreeCorePrompt,
		character: string | undefined,
		key?: { ctrl?: boolean; name?: string; sequence?: string },
	): void {
		this.worktreePrompt.handleKeypress(this, character, key);
	},
	writable: true,
});

function resolvePromptAction(
	character: string | undefined,
	key?: { ctrl?: boolean; name?: string; sequence?: string },
): WorktreePromptAction | undefined {
	if ((key?.ctrl && key.name === "c") || character === "\u0003") {
		return "cancel";
	}

	switch (key?.name) {
		case "escape":
			return "escape";
		case "return":
			return "enter";
		case "space":
			return "space";
		case "up":
		case "left":
			return "up";
		case "down":
		case "right":
			return "down";
	}

	switch (character) {
		case " ":
			return "space";
		case "k":
		case "h":
			return "up";
		case "j":
		case "l":
			return "down";
	}

	return undefined;
}

function promptGlyphs(): PromptGlyphs {
	return supportsUnicode()
		? {
				active: "●",
				bar: "│",
				checked: "◼",
				corner: "└",
				inactive: "○",
				pending: "◆",
				submitted: "◇",
				unchecked: "◻",
				uncheckedActive: "◻",
			}
		: {
				active: ">",
				bar: "|",
				checked: "[x]",
				corner: "-",
				inactive: " ",
				pending: "*",
				submitted: "o",
				unchecked: "[ ]",
				uncheckedActive: "[ ]",
			};
}

function promptColors(): PromptColors {
	return {
		activeBar: cyan,
		bar: gray,
		error: yellow,
		errorBar: yellow,
		hint: dim,
		key: cyan,
		option: cyan,
		search: cyan,
		selected: green,
		symbol: (value, state) => {
			if (state === "submit") return green(value);
			if (state === "error") return yellow(value);
			if (state === "cancel") return red(value);
			return cyan(value);
		},
	};
}

function promptFrameColor(
	state: string,
	colors: PromptColors,
): (value: string) => string {
	if (state === "error") return colors.errorBar;
	if (state === "active" || state === "initial") return colors.activeBar;
	return colors.bar;
}

function promptSymbol(state: string, glyphs: PromptGlyphs): string {
	return state === "submit" ? glyphs.submitted : glyphs.pending;
}

function cyan(value: string): string {
	return color("\u001b[36m", "\u001b[39m", value);
}

function dim(value: string): string {
	return color("\u001b[2m", "\u001b[22m", value);
}

function gray(value: string): string {
	return color("\u001b[90m", "\u001b[39m", value);
}

function green(value: string): string {
	return color("\u001b[32m", "\u001b[39m", value);
}

function red(value: string): string {
	return color("\u001b[31m", "\u001b[39m", value);
}

function yellow(value: string): string {
	return color("\u001b[33m", "\u001b[39m", value);
}

function color(open: string, close: string, value: string): string {
	if (env.NO_COLOR !== undefined) return value;
	return `${open}${value}${close}`;
}

function supportsUnicode(): boolean {
	if (platform !== "win32") {
		return env.TERM !== "linux";
	}

	return Boolean(
		env.CI ||
			env.WT_SESSION ||
			env.TERMINUS_SUBLIME ||
			env.ConEmuTask === "{cmd::Cmder}" ||
			env.TERM_PROGRAM === "Terminus-Sublime" ||
			env.TERM_PROGRAM === "vscode" ||
			env.TERM === "xterm-256color" ||
			env.TERM === "alacritty" ||
			env.TERMINAL_EMULATOR === "JetBrains-JediTerm",
	);
}

function renderPrompt(prompt: Prompt): void {
	(prompt as unknown as { render: () => void }).render();
}

function closePrompt(prompt: Prompt): void {
	(prompt as unknown as { close: () => void }).close();
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

function windowPromptEntries(
	entries: SearchablePromptEntry[],
	cursor: number,
	maxItems: number,
): Array<SearchablePromptEntry | "ellipsis"> {
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

function fitPromptPieces(pieces: PromptPiece[], width: number): string {
	const separator = " · ";
	let visiblePieces = pieces.filter((piece) => piece.value.length > 0);
	let available =
		width - separator.length * Math.max(0, visiblePieces.length - 1);

	while (
		visiblePieces.length > 1 &&
		available < minimumPieceLength(visiblePieces)
	) {
		const metadataIndex = visiblePieces.findIndex((piece) => piece.min === 10);
		const removableIndex =
			metadataIndex === -1 ? visiblePieces.length - 2 : metadataIndex;
		visiblePieces = visiblePieces.filter(
			(_, index) => index !== removableIndex,
		);
		available =
			width - separator.length * Math.max(0, visiblePieces.length - 1);
	}

	if (available <= 0 || available < minimumPieceLength(visiblePieces)) {
		return middleEllipsize(
			visiblePieces.map((piece) => piece.value).join(separator),
			width,
		);
	}

	const lengths = visiblePieces.map((piece) =>
		Math.min(piece.value.length, piece.max),
	);
	while (sum(lengths) > available) {
		const index = largestShrinkablePieceIndex(visiblePieces, lengths);
		if (index === -1) break;
		lengths[index] -= 1;
	}

	return visiblePieces
		.map((piece, index) => piece.ellipsize(piece.value, lengths[index]))
		.join(separator);
}

function minimumPieceLength(pieces: PromptPiece[]): number {
	return sum(pieces.map((piece) => Math.min(piece.value.length, piece.min)));
}

function largestShrinkablePieceIndex(
	pieces: PromptPiece[],
	lengths: number[],
): number {
	let candidate = -1;

	for (let index = 0; index < pieces.length; index += 1) {
		if (
			lengths[index] <= Math.min(pieces[index].value.length, pieces[index].min)
		) {
			continue;
		}

		if (candidate === -1 || lengths[index] > lengths[candidate]) {
			candidate = index;
		}
	}

	return candidate;
}

function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function filterSearchablePromptEntries(
	entries: SearchablePromptEntry[],
	query: string,
): SearchablePromptEntry[] {
	const filtered: SearchablePromptEntry[] = [];
	let pendingGroup: SearchablePromptEntry | null = null;

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

function isSelectableEntry(
	entry: SearchablePromptEntry | undefined,
): entry is SearchablePromptEntry & { value: string } {
	return (
		entry !== undefined &&
		entry.selectable !== false &&
		typeof entry.value === "string"
	);
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
): number {
	if (a.isCurrent && !b.isCurrent) return -1;
	if (!a.isCurrent && b.isCurrent) return 1;

	if (a.group !== b.group) {
		return groupRank(a.group) - groupRank(b.group);
	}

	const aRecent = a.lastActivityTimestamp ?? 0;
	const bRecent = b.lastActivityTimestamp ?? 0;
	if (aRecent !== bRecent) {
		return bRecent - aRecent;
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

function startEllipsize(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	if (maxLength <= 1) {
		return "…";
	}

	return `…${value.slice(value.length - maxLength + 1)}`;
}
