export async function mapWithConcurrency<Input, Output>(
	items: readonly Input[],
	limit: number,
	mapper: (item: Input) => Promise<Output>,
	signal?: AbortSignal,
): Promise<Output[]> {
	const results: Output[] = new Array(items.length);
	let nextIndex = 0;

	async function readNext(): Promise<void> {
		for (;;) {
			throwIfAborted(signal);
			const index = nextIndex;
			nextIndex += 1;
			if (index >= items.length) return;
			results[index] = await mapper(items[index]);
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, () => readNext()),
	);
	return results;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new Error("Operation cancelled");
}
