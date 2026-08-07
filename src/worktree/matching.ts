import type { WorktreeEntry } from "../repo.js";
import type { WorktreeSource } from "./source.js";

export function resolveWorktreeQuery(
	sources: WorktreeSource[],
	query: string,
): WorktreeSource | null {
	return resolveWorktreeQueryMatches(sources, query)[0] ?? null;
}

export function resolveWorktreeQueryMatches(
	sources: WorktreeSource[],
	query: string,
): WorktreeSource[] {
	const normalizedQuery = normalizeQuery(query);
	if (normalizedQuery === null) return [];

	const matches = findWorktreeSourceMatches(sources, normalizedQuery);
	if (isAmbiguousRepoOnlyQuery(matches, normalizedQuery)) return [];

	const bestScore = matches[0]?.matchScore;
	return matches
		.filter((match) => match.matchScore === bestScore)
		.map((match) => match.source);
}

export function resolveExactWorktreeQueryMatches(
	sources: WorktreeSource[],
	query: string,
): WorktreeSource[] {
	const normalizedQuery = normalizeQuery(query);
	if (normalizedQuery === null) return [];

	return sources.filter(
		(source) =>
			scoreWorktreeMatch(
				{
					...source.worktree,
					repoName: source.repoName,
				},
				normalizedQuery,
			) === 1000,
	);
}

function findWorktreeSourceMatches(
	sources: WorktreeSource[],
	normalizedQuery: string,
): { matchScore: number; source: WorktreeSource }[] {
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
	matches: { matchScore: number; source: WorktreeSource }[],
	query: string,
): boolean {
	if (matches[0]?.matchScore === 1000) return false;

	return (
		matches.filter((match) => match.source.repoName.toLowerCase() === query)
			.length > 1
	);
}

function compareQueryMatches(
	a: { matchScore: number; source: WorktreeSource },
	b: { matchScore: number; source: WorktreeSource },
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

function normalizeQuery(query?: string): string | null {
	const normalized = query?.trim().toLowerCase();
	return normalized && normalized.length > 0 ? normalized : null;
}

function scoreWorktreeMatch(
	entry: Pick<WorktreeEntry, "branch" | "path"> & { repoName: string },
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
