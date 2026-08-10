import { writeShellOutput } from "../../presentation/shell/handoff.js";
import { defaultCliDependencies } from "../dependencies.js";

const { detectRepository } = defaultCliDependencies.repositoryContext;

export interface RootCommandOptions {
	cwd: string;
	print?: boolean;
	stdout: (chunk: string) => void;
}

const ROOT_OUTPUT_FILE_ENV = "GJI_ROOT_OUTPUT_FILE";

export async function runRootCommand(
	options: RootCommandOptions,
): Promise<number> {
	const repository = await detectRepository(options.cwd);

	if (!options.print && process.env[ROOT_OUTPUT_FILE_ENV]) {
		await writeShellOutput(
			ROOT_OUTPUT_FILE_ENV,
			repository.repoRoot,
			options.stdout,
		);
		return 0;
	}

	options.stdout(`${repository.repoRoot}\n`);

	return 0;
}
