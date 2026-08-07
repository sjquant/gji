import { confirm, isCancel } from "@clack/prompts";

export async function defaultConfirmForceRemoveWorktree(
	worktreePath: string,
): Promise<boolean> {
	const choice = await confirm({
		active: "Yes",
		inactive: "No",
		initialValue: false,
		message: `Worktree at ${worktreePath} contains files or initialized submodules that cannot be undone. Force remove?`,
	});

	return !isCancel(choice) && choice;
}

export async function defaultConfirmForceDeleteBranch(
	branch: string,
): Promise<boolean> {
	const choice = await confirm({
		active: "Yes",
		inactive: "No",
		initialValue: false,
		message: `Branch ${branch} has unmerged commits. Force delete?`,
	});

	return !isCancel(choice) && choice;
}
