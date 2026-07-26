import { detectRepository } from "./repo.js";
import { clearTask, readTask, writeTask } from "./task.js";

export interface TaskCommandOptions {
	clear?: boolean;
	cwd: string;
	json?: boolean;
	task?: string;
	stderr: (chunk: string) => void;
	stdout: (chunk: string) => void;
}

export async function runTaskCommand(
	options: TaskCommandOptions,
): Promise<number> {
	const repository = await detectRepository(options.cwd);
	if (options.clear && options.task !== undefined)
		return emitTaskError(options, "--clear cannot be combined with a task");

	if (options.clear) await clearTask(repository.currentRoot);
	else if (options.task !== undefined)
		await writeTask(repository.currentRoot, options.task);

	const task = await readTask(repository.currentRoot);
	if (options.json) {
		options.stdout(
			`${JSON.stringify({ task: task?.task ?? null }, null, 2)}\n`,
		);
	} else if (task) {
		options.stdout(`${task.task}\n`);
	} else {
		options.stdout('no task set — set one: gji task "..."\n');
	}
	return 0;
}

function emitTaskError(options: TaskCommandOptions, message: string): number {
	if (options.json) options.stderr(`${JSON.stringify({ error: message })}\n`);
	else options.stderr(`gji task: ${message}\n`);
	return 1;
}
