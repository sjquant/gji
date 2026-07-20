import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";

import {
	confirm,
	intro,
	isCancel,
	log,
	outro,
	select,
	text,
} from "@clack/prompts";

import {
	loadConfig,
	loadGlobalConfig,
	saveGlobalConfig,
	saveLocalConfig,
	updateGlobalConfigKey,
} from "./config.js";
import { EDITORS } from "./editor.js";
import { isHeadless } from "./headless.js";
import { resolveSupportedShell, type SupportedShell } from "./shell.js";
import { renderShellCompletion } from "./shell-completion.js";
import {
	SHELL_INTEGRATION_END_MARKER as END_MARKER,
	executableExists,
	hasShellIntegration,
	ONBOARDING_SHELL_INTEGRATION_END_MARKER as ONBOARDING_END_MARKER,
	ONBOARDING_SHELL_INTEGRATION_START_MARKER as ONBOARDING_START_MARKER,
	resolveCompletionPath,
	resolveShellConfigPath,
	SHELL_INTEGRATION_START_MARKER as START_MARKER,
} from "./shell-setup.js";

const ZSH_COMPLETION_PATH_LINE = "fpath=(~/.zsh/completions $fpath)";

interface ShellWrappedCommand {
	bypassOptions: string[];
	commandName: string;
	envVar: string;
	names: string[];
	tempPrefix: string;
}

const SHELL_WRAPPED_COMMANDS: ShellWrappedCommand[] = [
	{
		bypassOptions: ["--help", "-h", "--json"],
		commandName: "new",
		envVar: "GJI_NEW_OUTPUT_FILE",
		names: ["new"],
		tempPrefix: "gji-new",
	},
	{
		bypassOptions: ["--help", "-h", "--json"],
		commandName: "pr",
		envVar: "GJI_PR_OUTPUT_FILE",
		names: ["pr"],
		tempPrefix: "gji-pr",
	},
	{
		bypassOptions: ["--print", "--help", "-h"],
		commandName: "back",
		envVar: "GJI_BACK_OUTPUT_FILE",
		names: ["back"],
		tempPrefix: "gji-back",
	},
	{
		bypassOptions: ["--print", "--json", "--help", "-h"],
		commandName: "go",
		envVar: "GJI_GO_OUTPUT_FILE",
		names: ["go", "jump"],
		tempPrefix: "gji-go",
	},
	{
		bypassOptions: ["--print", "--help", "-h"],
		commandName: "root",
		envVar: "GJI_ROOT_OUTPUT_FILE",
		names: ["root"],
		tempPrefix: "gji-root",
	},
	{
		bypassOptions: ["--help", "-h", "--json"],
		commandName: "remove",
		envVar: "GJI_REMOVE_OUTPUT_FILE",
		names: ["remove", "rm"],
		tempPrefix: "gji-remove",
	},
	{
		bypassOptions: ["--help", "-h", "--json"],
		commandName: "done",
		envVar: "GJI_DONE_OUTPUT_FILE",
		names: ["done"],
		tempPrefix: "gji-done",
	},
	{
		bypassOptions: ["--print", "--json", "--help", "-h"],
		commandName: "warp",
		envVar: "GJI_WARP_OUTPUT_FILE",
		names: ["warp"],
		tempPrefix: "gji-warp",
	},
];

export type InstallSaveTarget = "local" | "global";
export type ShellIntegrationChoice = "existing" | "install" | "skip";

export interface SetupWizardResult {
	branchPrefix?: string;
	hooks?: {
		"after-create"?: string;
		"after-enter"?: string;
		"before-remove"?: string;
	};
	installSaveTarget: InstallSaveTarget;
	worktreePath?: string;
}

export interface InitOnboardingResult {
	editor?: string;
	installCompletion: boolean;
	shellIntegration: ShellIntegrationChoice;
	shell: SupportedShell;
}

interface InitOnboardingContext {
	detectedShell: SupportedShell | null;
	home: string;
}

export interface InitCommandOptions {
	cwd: string;
	home?: string;
	interactive?: boolean;
	json?: boolean;
	promptForOnboarding?: (
		context: InitOnboardingContext,
	) => Promise<InitOnboardingResult | null>;
	promptForSetup?: () => Promise<SetupWizardResult | null>;
	shell?: string;
	stderr?: (chunk: string) => void;
	stdout: (chunk: string) => void;
	write?: boolean;
}

export async function runInitCommand(
	options: InitCommandOptions,
): Promise<number> {
	if (options.shell === undefined) {
		return runOnboardingInitCommand(options);
	}

	return runLegacyInitCommand(options);
}

async function runOnboardingInitCommand(
	options: InitCommandOptions,
): Promise<number> {
	if (options.json || isHeadless() || !canRunOnboarding(options)) {
		return writeNonInteractiveInitError(options);
	}

	const home = options.home ?? homedir();
	const context: InitOnboardingContext = {
		detectedShell: resolveSupportedShell(undefined, process.env.SHELL),
		home,
	};

	if (options.promptForOnboarding === undefined) {
		return runDefaultOnboarding(context);
	}

	const result = await options.promptForOnboarding(context);

	if (!result) {
		options.stderr?.("Aborted.\n");
		return 1;
	}

	await applyOnboardingResult(result, home);

	return 0;
}

function canRunOnboarding(options: InitCommandOptions): boolean {
	return (
		options.interactive ??
		(options.promptForOnboarding !== undefined ||
			(process.stdin.isTTY === true && process.stdout.isTTY === true))
	);
}

function writeNonInteractiveInitError(options: InitCommandOptions): number {
	const error = "run `gji init <shell> --write` in non-interactive mode";

	options.stderr?.(
		options.json ? `${JSON.stringify({ error })}\n` : `${error}\n`,
	);

	return 1;
}

async function runDefaultOnboarding(
	context: InitOnboardingContext,
): Promise<number> {
	intro("gji init");

	const shell = await select<SupportedShell>({
		message: "Which shell should gji configure?",
		initialValue: context.detectedShell ?? "zsh",
		options: [
			{ value: "zsh", label: "zsh" },
			{ value: "bash", label: "bash" },
			{ value: "fish", label: "fish" },
		],
	});
	if (isCancel(shell)) return abortDefaultOnboarding();

	const rcPath = resolveShellConfigPath(shell, context.home);
	const currentConfig = await readExistingConfig(rcPath);
	const shellIntegration = await promptForShellIntegration(
		currentConfig,
		rcPath,
		shell,
	);
	if (shellIntegration === null) return abortDefaultOnboarding();

	const completionPath = resolveCompletionPath(shell, context.home);
	const completionAlreadyInstalled = await fileExists(completionPath);
	await applyShellIntegration(shell, shellIntegration, context.home);

	const installCompletion = await promptForCompletion(shell, completionPath);
	if (installCompletion === null) return abortDefaultOnboarding();
	if (installCompletion) {
		await mkdir(dirname(completionPath), { recursive: true });
		await writeFile(completionPath, renderShellCompletion(shell), "utf8");
	}
	if (shell === "zsh" && (completionAlreadyInstalled || installCompletion)) {
		await ensureZshCompletionPath(rcPath);
	}

	const editor = await promptForEditor();
	if (editor === null) return abortDefaultOnboarding();
	if (editor) {
		await updateGlobalConfigKey("editor", editor, context.home);
	}

	outro(
		`Setup complete. Restart your shell or run: source ${rcPath}\nVerify with: gji doctor`,
	);

	return 0;
}

async function applyShellIntegration(
	shell: SupportedShell,
	choice: ShellIntegrationChoice,
	home: string,
): Promise<void> {
	if (choice === "install") {
		await installOnboardingShellIntegration(shell, home);
	}

	if (choice !== "skip") {
		await updateGlobalConfigKey("shellIntegration", true, home);
	}
}

function abortDefaultOnboarding(): number {
	outro("Aborted.");

	return 1;
}

async function promptForShellIntegration(
	currentConfig: string,
	rcPath: string,
	shell: SupportedShell,
): Promise<ShellIntegrationChoice | null> {
	if (
		currentConfig.includes(ONBOARDING_START_MARKER) &&
		currentConfig.includes(ONBOARDING_END_MARKER)
	) {
		log.success(`Shell integration marker found in ${rcPath}; refreshing it.`);
		return "install";
	}

	if (hasShellIntegration(currentConfig, shell)) {
		log.success(`Shell integration already installed in ${rcPath} ✓`);
		return "existing";
	}

	const confirmed = await confirm({
		message: `Install shell integration in ${rcPath}?`,
		initialValue: true,
	});
	if (isCancel(confirmed)) return null;

	return confirmed ? "install" : "skip";
}

async function promptForCompletion(
	shell: SupportedShell,
	completionPath: string,
): Promise<boolean | null> {
	if (await fileExists(completionPath)) {
		log.success(`${shell} completion already installed at ${completionPath} ✓`);
		return false;
	}

	const confirmed = await confirm({
		message: `Install ${shell} completion at ${completionPath}?`,
		initialValue: true,
	});
	if (isCancel(confirmed)) return null;

	return confirmed;
}

async function promptForEditor(): Promise<string | null | undefined> {
	const availableEditors = await findAvailableEditors();
	if (availableEditors.length === 0) {
		log.info("No supported editor CLIs found on PATH; skipping editor setup.");
		return undefined;
	}

	const skipValue = "__gji_skip_editor__";
	const selected = await select<string>({
		message: "Which editor should gji use?",
		options: [
			...availableEditors.map(({ cli, name }) => ({
				value: cli,
				label: name,
				hint: cli,
			})),
			{ value: skipValue, label: "Skip" },
		],
	});
	if (isCancel(selected)) return null;

	return selected === skipValue ? undefined : selected;
}

async function findAvailableEditors(): Promise<typeof EDITORS> {
	const availableEditors = [] as typeof EDITORS;

	for (const editor of EDITORS) {
		if (await executableExists(editor.cli)) {
			availableEditors.push(editor);
		}
	}

	return availableEditors;
}

async function applyOnboardingResult(
	result: InitOnboardingResult,
	home: string,
): Promise<void> {
	const rcPath = resolveShellConfigPath(result.shell, home);
	const completionPath = resolveCompletionPath(result.shell, home);
	const completionAlreadyInstalled = await fileExists(completionPath);

	await applyShellIntegration(result.shell, result.shellIntegration, home);

	if (result.installCompletion) {
		await mkdir(dirname(completionPath), { recursive: true });
		await writeFile(
			completionPath,
			renderShellCompletion(result.shell),
			"utf8",
		);
	}

	if (
		result.shell === "zsh" &&
		(completionAlreadyInstalled || result.installCompletion)
	) {
		await ensureZshCompletionPath(rcPath);
	}

	if (result.editor) {
		await updateGlobalConfigKey("editor", result.editor, home);
	}
}

async function installOnboardingShellIntegration(
	shell: SupportedShell,
	home: string,
): Promise<void> {
	const rcPath = resolveShellConfigPath(shell, home);
	await mkdir(dirname(rcPath), { recursive: true });
	const current = await readExistingConfig(rcPath);

	if (shell === "fish") {
		await writeFile(
			rcPath,
			upsertShellIntegration(current, renderShellIntegration(shell)),
			"utf8",
		);
		return;
	}

	await writeFile(
		rcPath,
		upsertOnboardingShellIntegration(current, shell),
		"utf8",
	);
}

function upsertOnboardingShellIntegration(
	existingConfig: string,
	shell: "bash" | "zsh",
): string {
	const script = renderOnboardingShellIntegration(shell).trimEnd();
	const blockPattern = new RegExp(
		`${escapeForRegExp(ONBOARDING_START_MARKER)}[\\s\\S]*?${escapeForRegExp(ONBOARDING_END_MARKER)}\\n?`,
		"m",
	);

	if (blockPattern.test(existingConfig)) {
		return ensureTrailingNewline(
			existingConfig.replace(blockPattern, `${script}\n`),
		);
	}

	const prefix = existingConfig.trimEnd();
	if (prefix.length === 0) return ensureTrailingNewline(script);

	return ensureTrailingNewline(`${prefix}\n\n${script}`);
}

function renderOnboardingShellIntegration(shell: "bash" | "zsh"): string {
	return `${ONBOARDING_START_MARKER}
eval "$(gji init ${shell})"
${ONBOARDING_END_MARKER}
`;
}

async function ensureZshCompletionPath(rcPath: string): Promise<void> {
	const current = await readExistingConfig(rcPath);
	const next = upsertZshCompletionPath(current);

	if (next !== current) {
		await writeFile(rcPath, next, "utf8");
	}
}

function upsertZshCompletionPath(existingConfig: string): string {
	const configWithoutCompletionPath = existingConfig
		.replace(
			/# >>> gji zsh completion path >>>[\s\S]*?# <<< gji zsh completion path <<<\n?/m,
			"",
		)
		.replace(
			new RegExp(
				`^[\\t ]*${escapeForRegExp(ZSH_COMPLETION_PATH_LINE)}[\\t ]*\\n?`,
				"gm",
			),
			"",
		);
	const suffix = configWithoutCompletionPath
		.replace(/^(?:\r?\n)+/, "")
		.trimEnd();

	// Frameworks can invoke compinit from a sourced file, so this must come first.
	return ensureTrailingNewline(
		suffix.length === 0
			? ZSH_COMPLETION_PATH_LINE
			: `${ZSH_COMPLETION_PATH_LINE}\n\n${suffix}`,
	);
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function runLegacyInitCommand(
	options: InitCommandOptions,
): Promise<number> {
	const shell = resolveSupportedShell(options.shell, process.env.SHELL);
	const home = options.home ?? homedir();

	if (!shell) {
		options.stderr?.(
			"Unable to detect a supported shell. Specify one explicitly: bash, fish, or zsh.\n",
		);
		return 1;
	}

	const script = renderShellIntegration(shell);

	if (!options.write) {
		options.stdout(script);
		return 0;
	}

	const rcPath = resolveShellConfigPath(shell, home);
	await mkdir(dirname(rcPath), { recursive: true });

	const current = await readExistingConfig(rcPath);
	const next = upsertShellIntegration(current, script);
	await writeFile(rcPath, next, "utf8");

	options.stdout(`${rcPath}\n`);

	// Run the setup wizard on the first-ever init (not on subsequent re-runs).
	const { config: globalConfig } = await loadGlobalConfig(home);
	const alreadyConfigured =
		"shellIntegration" in globalConfig || "installSaveTarget" in globalConfig;
	const hasCustomPrompt = options.promptForSetup !== undefined;
	const canPrompt =
		!isHeadless() && (hasCustomPrompt || process.stdout.isTTY === true);

	if (!alreadyConfigured && canPrompt) {
		const prompt = options.promptForSetup ?? defaultPromptForSetup;
		const result = await prompt();
		if (result) {
			await updateGlobalConfigKey(
				"installSaveTarget",
				result.installSaveTarget,
				home,
			);
			await saveWizardConfig(result, options.cwd, home);
		}
	}

	// Mark shell integration as installed so the first-run nudge is suppressed.
	await updateGlobalConfigKey("shellIntegration", true, home);

	return 0;
}

export function renderShellIntegration(shell: SupportedShell): string {
	const commandBlocks = SHELL_WRAPPED_COMMANDS.map((command) =>
		shell === "fish" ? renderFishWrapper(command) : renderPosixWrapper(command),
	).join("\n\n");

	switch (shell) {
		case "fish":
			return `${START_MARKER}
function gji --wraps gji --description 'gji shell integration'
${indentBlock(commandBlocks, 4)}

    command gji $argv
end
${END_MARKER}
`;
		case "bash":
		case "zsh":
			return `${START_MARKER}
gji() {
${indentBlock(commandBlocks, 2)}

  command gji "$@"
}
${END_MARKER}
`;
	}
}

export function upsertShellIntegration(
	existingConfig: string,
	script: string,
): string {
	const trimmedScript = script.trimEnd();
	const blockPattern = new RegExp(
		`${escapeForRegExp(START_MARKER)}[\\s\\S]*?${escapeForRegExp(END_MARKER)}\\n?`,
		"m",
	);

	if (blockPattern.test(existingConfig)) {
		return ensureTrailingNewline(
			existingConfig.replace(blockPattern, `${trimmedScript}\n`),
		);
	}

	const prefix = existingConfig.trimEnd();

	if (prefix.length === 0) {
		return ensureTrailingNewline(trimmedScript);
	}

	return ensureTrailingNewline(`${prefix}\n\n${trimmedScript}`);
}

async function saveWizardConfig(
	result: SetupWizardResult,
	cwd: string,
	home: string,
): Promise<void> {
	const values: Record<string, unknown> = {};

	if (result.branchPrefix) values.branchPrefix = result.branchPrefix;
	if (result.worktreePath) values.worktreePath = result.worktreePath;

	const hooks: Record<string, string> = {};
	if (result.hooks?.["after-create"])
		hooks["after-create"] = result.hooks["after-create"];
	if (result.hooks?.["after-enter"])
		hooks["after-enter"] = result.hooks["after-enter"];
	if (result.hooks?.["before-remove"])
		hooks["before-remove"] = result.hooks["before-remove"];
	if (Object.keys(hooks).length > 0) values.hooks = hooks;

	if (Object.keys(values).length === 0) return;

	if (result.installSaveTarget === "local") {
		const loaded = await loadConfig(cwd);
		await saveLocalConfig(cwd, { ...loaded.config, ...values });
	} else {
		const { config: existing } = await loadGlobalConfig(home);
		await saveGlobalConfig({ ...existing, ...values }, home);
	}
}
async function readExistingConfig(path: string): Promise<string> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) {
			return "";
		}

		throw error;
	}
}

function ensureTrailingNewline(value: string): string {
	return value.endsWith("\n") ? value : `${value}\n`;
}

function escapeForRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function renderFishWrapper(command: ShellWrappedCommand): string {
	const nameTests = command.names.map((name) => `test $argv[1] = ${name}`);
	const nameCondition =
		nameTests.length === 1
			? nameTests[0]
			: `begin; ${nameTests.join("; or ")}; end`;

	const bypassBlock = `if test (count $argv) -gt 0
        for arg in $argv
            if ${command.bypassOptions.map((opt) => `test $arg = ${opt}`).join("; or ")}
                command gji ${command.commandName} $argv
                return $status
            end
        end
    end`;

	return `if test (count $argv) -gt 0; and ${nameCondition}
    set -e argv[1]
    ${bypassBlock}

    set -l output_file (mktemp -t ${command.tempPrefix}.XXXXXX)
    or return 1
    env ${command.envVar}=$output_file command gji ${command.commandName} $argv
    or begin
        set -l status_code $status
        rm -f $output_file
        return $status_code
    end
    set -l target (cat $output_file)
    rm -f $output_file
    cd $target
    return $status
end`;
}

function renderPosixWrapper(command: ShellWrappedCommand): string {
	const tests = command.names
		.map((name) => `[ "$1" = "${name}" ]`)
		.join(" || ");
	const bypassBlock = `for arg do
    if ${command.bypassOptions.map((opt) => `[ "$arg" = "${opt}" ]`).join(" || ")}; then
      command gji ${command.commandName} "$@"
      return $?
    fi
  done`;

	return `if ${tests}; then
  shift
  ${bypassBlock}

  local target
  local output_file
  output_file="$(mktemp -t ${command.tempPrefix}.XXXXXX)" || return 1
  ${command.envVar}="$output_file" command gji ${command.commandName} "$@" || { local exit_code=$?; rm -f "$output_file"; return $exit_code; }
  target="$(cat "$output_file")"
  rm -f "$output_file"
  cd "$target" || return $?
  return 0
fi`;
}

function indentBlock(value: string, spaces: number): string {
	const prefix = " ".repeat(spaces);

	return value
		.split("\n")
		.map((line) => (line.length === 0 ? "" : `${prefix}${line}`))
		.join("\n");
}

async function defaultPromptForSetup(): Promise<SetupWizardResult | null> {
	intro("gji setup");

	const installSaveTarget = await select<InstallSaveTarget>({
		message: "Where should preferences be saved?",
		options: [
			{
				value: "global",
				label: "~/.config/gji/config.json",
				hint: "personal — never committed",
			},
			{
				value: "local",
				label: ".gji.json",
				hint: "repo — committed with the project",
			},
		],
	});

	if (isCancel(installSaveTarget)) {
		outro("Setup skipped.");
		return null;
	}

	const branchPrefix = await text({
		message: "Default branch prefix?",
		placeholder: "e.g. feat/ or fix/ — leave blank to skip",
	});

	if (isCancel(branchPrefix)) {
		outro("Setup skipped.");
		return null;
	}

	const worktreePath = await text({
		message: "Worktree base path?",
		placeholder: "leave blank to use the default path",
	});

	if (isCancel(worktreePath)) {
		outro("Setup skipped.");
		return null;
	}

	const afterCreate = await text({
		message: "after-create hook — run after creating a worktree?",
		placeholder: "e.g. pnpm install — leave blank to skip",
	});

	if (isCancel(afterCreate)) {
		outro("Setup skipped.");
		return null;
	}

	const afterEnter = await text({
		message: "after-enter hook — run after entering a worktree?",
		placeholder: "e.g. nvm use — leave blank to skip",
	});

	if (isCancel(afterEnter)) {
		outro("Setup skipped.");
		return null;
	}

	const beforeRemove = await text({
		message: "before-remove hook — run before removing a worktree?",
		placeholder: "leave blank to skip",
	});

	if (isCancel(beforeRemove)) {
		outro("Setup skipped.");
		return null;
	}

	outro("Setup complete!");

	const hooks: SetupWizardResult["hooks"] = {};
	if (afterCreate) hooks["after-create"] = afterCreate;
	if (afterEnter) hooks["after-enter"] = afterEnter;
	if (beforeRemove) hooks["before-remove"] = beforeRemove;

	return {
		branchPrefix: branchPrefix || undefined,
		hooks: Object.keys(hooks).length > 0 ? hooks : undefined,
		installSaveTarget,
		worktreePath: worktreePath || undefined,
	};
}
