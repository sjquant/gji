export async function mapWithConcurrency<Input, Output>(
	items: readonly Input[],
	limit: number,
	mapper: (item: Input) => Promise<Output>,
): Promise<Output[]> {
	const results: Output[] = new Array(items.length);
	let nextIndex = 0;

	async function readNext(): Promise<void> {
		for (;;) {
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
