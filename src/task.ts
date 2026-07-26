import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { worktreeGitDir } from "./repo.js";

export type TaskSource = "manual" | "pr";

export interface TaskMetadata {
	source: TaskSource;
	task: string;
	updatedAt: number;
}

export async function readTask(
	worktreePath: string,
): Promise<TaskMetadata | null> {
	try {
		const parsed = JSON.parse(
			await readFile(await taskPath(worktreePath), "utf8"),
		) as unknown;
		return isTaskMetadata(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export async function writeTask(
	worktreePath: string,
	task: string,
	source: TaskSource = "manual",
): Promise<TaskMetadata> {
	const metadata: TaskMetadata = { source, task, updatedAt: Date.now() };
	const path = await taskPath(worktreePath);
	await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
	return metadata;
}

export async function clearTask(worktreePath: string): Promise<void> {
	try {
		await unlink(await taskPath(worktreePath));
	} catch {
		// Missing task metadata is already the desired state.
	}
}

async function taskPath(worktreePath: string): Promise<string> {
	return join(await worktreeGitDir(worktreePath), "gji-task.json");
}

function isTaskMetadata(value: unknown): value is TaskMetadata {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.task === "string" &&
		(candidate.source === "manual" || candidate.source === "pr") &&
		typeof candidate.updatedAt === "number"
	);
}
