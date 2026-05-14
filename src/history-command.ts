import { formatHistoryList } from "./back.js";
import { loadHistory } from "./history.js";

export interface HistoryCommandOptions {
	cwd: string;
	home?: string;
	json?: boolean;
	stdout: (chunk: string) => void;
}

export async function runHistoryCommand(
	options: HistoryCommandOptions,
): Promise<number> {
	const history = await loadHistory(options.home);

	if (options.json) {
		options.stdout(`${JSON.stringify(history, null, 2)}\n`);
		return 0;
	}

	if (history.length === 0) {
		options.stdout("No navigation history.\n");
		return 0;
	}

	options.stdout(formatHistoryList(history, options.cwd));
	return 0;
}
