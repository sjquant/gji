export function parsePrInput(input: string): string | null {
	if (/^\d+$/.test(input)) return input;

	const hashMatch = input.match(/^#(\d+)$/);
	if (hashMatch) return hashMatch[1];

	const urlMatch = input.match(
		/(?:\/pull|\/pull-requests|\/merge_requests)\/(\d+)/,
	);
	return urlMatch?.[1] ?? null;
}
