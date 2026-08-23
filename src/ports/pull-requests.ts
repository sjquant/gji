export interface PullRequestInfo {
	number: number;
	sourceBranch: string;
	title?: string;
	url: string;
}

export interface PullRequestPort {
	findOpenPullRequest(
		repoRoot: string,
		number: number,
	): Promise<PullRequestInfo | null>;
	listOpenPullRequests(
		repoRoot: string,
		sourceBranch: string,
	): Promise<PullRequestInfo[]>;
	listOpenPullRequestsForRepository(
		repoRoot: string,
	): Promise<PullRequestInfo[]>;
}
