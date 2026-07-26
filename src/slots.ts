import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { GLOBAL_CONFIG_DIRECTORY } from "./config.js";

export interface SlotStore {
	[worktreePath: string]: number;
}

export function SLOTS_FILE_PATH(home: string = homedir()): string {
	const configDir = process.env.GJI_CONFIG_DIR;
	return configDir
		? join(resolve(configDir), "slots.json")
		: join(home, GLOBAL_CONFIG_DIRECTORY, "slots.json");
}

export async function loadSlots(home: string = homedir()): Promise<SlotStore> {
	try {
		const parsed = JSON.parse(
			await readFile(SLOTS_FILE_PATH(home), "utf8"),
		) as unknown;
		if (!isSlotStore(parsed)) return {};
		return parsed;
	} catch {
		return {};
	}
}

export async function assignWorktreeSlot(
	repoRoot: string,
	worktreePath: string,
	home: string = homedir(),
): Promise<number> {
	const slots = await loadSlots(home);
	const existing = slots[worktreePath];
	if (existing !== undefined) return existing;
	if (worktreePath !== repoRoot && slots[repoRoot] === undefined)
		slots[repoRoot] = 0;

	const used = new Set(Object.values(slots));
	const slot = worktreePath === repoRoot ? 0 : nextAvailableSlot(used);
	slots[worktreePath] = slot;
	await saveSlots(slots, home);
	return slot;
}

export async function getWorktreeSlot(
	worktreePath: string,
	home: string = homedir(),
): Promise<number | null> {
	const slot = (await loadSlots(home))[worktreePath];
	return slot === undefined ? null : slot;
}

export async function releaseWorktreeSlot(
	worktreePath: string,
	home: string = homedir(),
): Promise<void> {
	const slots = await loadSlots(home);
	if (!(worktreePath in slots)) return;
	delete slots[worktreePath];
	await saveSlots(slots, home);
}

async function saveSlots(slots: SlotStore, home: string): Promise<void> {
	const path = SLOTS_FILE_PATH(home);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(slots, null, 2)}\n`, "utf8");
}

function nextAvailableSlot(used: Set<number>): number {
	let slot = 1;
	while (used.has(slot)) slot += 1;
	return slot;
}

function isSlotStore(value: unknown): value is SlotStore {
	return (
		typeof value === "object" &&
		value !== null &&
		Object.values(value).every((slot) => Number.isInteger(slot) && slot >= 0)
	);
}
