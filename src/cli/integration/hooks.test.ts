import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { resolveWorktreePath } from "../../domain/worktree/policy.js";
import { GLOBAL_CONFIG_FILE_PATH } from "../../infrastructure/persistence/config.js";
import {
	extractHooks,
	interpolate,
	runHook,
} from "../../infrastructure/process/hooks.js";
import {
	addLinkedWorktree,
	commitFile,
	createRepository,
	createRepositoryWithOrigin,
	pushPullRequestRef,
	runGit,
} from "../../test-support/repository.js";
import { runCli } from "../program.js";

const originalHome = process.env.HOME;

afterEach(() => {
	if (originalHome === undefined) {
		delete process.env.HOME;
		return;
	}
	process.env.HOME = originalHome;
});

describe("interpolate", () => {
	it("replaces {{branch}} with the branch name", () => {
		// Given a template referencing {{branch}} and a context with a branch value.
		// Then {{branch}} is replaced with the value from context.
		expect(
			interpolate("echo {{branch}}", {
				branch: "feature/foo",
				path: "/p",
				repo: "r",
			}),
		).toBe("echo feature/foo");
	});

	it("replaces {{path}} with the worktree path", () => {
		// Given a template referencing {{path}} and a context with a path value.
		// Then {{path}} is replaced with the value from context.
		expect(
			interpolate("cd {{path}}", {
				branch: "main",
				path: "/worktrees/r/main",
				repo: "r",
			}),
		).toBe("cd /worktrees/r/main");
	});

	it("replaces {{repo}} with the repo name", () => {
		// Given a template referencing {{repo}} and a context with a repo value.
		// Then {{repo}} is replaced with the value from context.
		expect(interpolate("echo {{repo}}", { path: "/p", repo: "myrepo" })).toBe(
			"echo myrepo",
		);
	});

	it("replaces all occurrences of a variable", () => {
		// Given a template with the same variable used twice.
		// Then both occurrences are replaced.
		expect(
			interpolate("{{branch}} {{branch}}", {
				branch: "main",
				path: "/p",
				repo: "r",
			}),
		).toBe("main main");
	});

	it("substitutes empty string for a missing branch", () => {
		// Given a template referencing {{branch}} and a context with no branch.
		// Then {{branch}} is replaced with an empty string.
		expect(interpolate("echo {{branch}}", { path: "/p", repo: "r" })).toBe(
			"echo ",
		);
	});
});

describe("extractHooks", () => {
	it("returns empty object when no hooks key exists", () => {
		// Given a config with no hooks key.
		// Then extractHooks returns an empty object.
		expect(extractHooks({})).toEqual({});
	});

	it("extracts after-create", () => {
		// Given a config with only an after-create hook.
		// Then extractHooks returns only that hook.
		expect(extractHooks({ hooks: { "after-create": "pnpm install" } })).toEqual(
			{
				"after-create": "pnpm install",
			},
		);
	});

	it("extracts every lifecycle hook type", () => {
		// Given a config with every hook key set.
		// Then extractHooks returns all of them.
		expect(
			extractHooks({
				hooks: {
					"after-branch-create": "d",
					"after-create": "a",
					"after-enter": "b",
					"after-switch": "e",
					"before-remove": "c",
				},
			}),
		).toEqual({
			"after-branch-create": "d",
			"after-create": "a",
			"after-enter": "b",
			"after-switch": "e",
			"before-remove": "c",
		});
	});

	it("extracts argv hook commands", () => {
		// Given a config with an argv-form hook command.
		const config = { hooks: { "after-create": ["pnpm", "install"] } };

		// When hooks are extracted.
		const hooks = extractHooks(config);

		// Then the argv command is preserved.
		expect(hooks).toEqual({ "after-create": ["pnpm", "install"] });
	});

	it("ignores non-string hook values", () => {
		// Given a config with hooks set to non-string values.
		// Then extractHooks omits those keys.
		expect(
			extractHooks({ hooks: { "after-create": 123, "after-enter": null } }),
		).toEqual({});
	});

	it("ignores invalid argv hook values", () => {
		// Given a config with empty and mixed-type argv hook commands.
		const config = {
			hooks: {
				"after-create": [],
				"after-enter": ["pnpm", 123],
				"before-remove": ["", "arg"],
			},
		};

		// When hooks are extracted.
		const hooks = extractHooks(config);

		// Then invalid argv commands are omitted.
		expect(hooks).toEqual({});
	});

	it("accepts legacy camelCase keys as fallback", () => {
		// Given a config with camelCase hook keys.
		// Then extractHooks maps them to the kebab-case keys.
		expect(
			extractHooks({
				hooks: {
					afterBranchCreate: "echo branch",
					afterCreate: "pnpm install",
					afterSwitch: "echo switch",
				},
			}),
		).toEqual({
			"after-branch-create": "echo branch",
			"after-create": "pnpm install",
			"after-switch": "echo switch",
		});
	});

	it("prefers kebab-case over camelCase when both present", () => {
		// Given a config with both the old and new keys for the same hook.
		// Then the kebab-case value wins.
		expect(
			extractHooks({ hooks: { afterCreate: "old", "after-create": "new" } }),
		).toEqual({ "after-create": "new" });
	});

	it("ignores a hooks key that is not a plain object", () => {
		// Given a config where the hooks key is a primitive or array.
		// Then extractHooks treats it as if no hooks were configured.
		expect(extractHooks({ hooks: "invalid" })).toEqual({});
		expect(extractHooks({ hooks: [] })).toEqual({});
		expect(extractHooks({ hooks: 42 })).toEqual({});
	});
});

describe("runHook", () => {
	it("does nothing when hookCmd is undefined", async () => {
		// Given no hook command is configured.
		const stderr: string[] = [];

		// When runHook is called with undefined.
		await runHook(undefined, "/tmp", { path: "/tmp", repo: "r" }, (c) =>
			stderr.push(c),
		);

		// Then nothing is emitted to stderr.
		expect(stderr).toEqual([]);
	});

	it("executes a shell command in the given cwd", async () => {
		// Given a temporary directory and a hook that creates a marker file.
		const dir = await mkdtemp(join(tmpdir(), "gji-hooks-"));
		const markerFile = join(dir, "hook-ran.txt");
		const stderr: string[] = [];

		// When runHook is called with that command.
		await runHook(`touch "${markerFile}"`, dir, { path: dir, repo: "r" }, (c) =>
			stderr.push(c),
		);

		// Then the marker file exists and no errors were emitted.
		await expect(readFile(markerFile)).resolves.toBeDefined();
		expect(stderr).toEqual([]);
	});

	it("forwards hook stdout through the provided callback", async () => {
		// Given a hook that writes to stdout and separate output collectors.
		const dir = await mkdtemp(join(tmpdir(), "gji-hooks-"));
		const stderr: string[] = [];
		const stdout: string[] = [];

		// When runHook executes the command.
		await runHook(
			"printf 'hook output'",
			dir,
			{ path: dir, repo: "r" },
			(chunk) => stderr.push(chunk),
			(chunk) => stdout.push(chunk),
		);

		// Then stdout is captured separately from stderr.
		expect(stdout.join("")).toBe("hook output");
		expect(stderr).toEqual([]);
	});

	it("executes an argv command in the given cwd", async () => {
		// Given a temporary directory and an argv hook that writes a marker file.
		const dir = await mkdtemp(join(tmpdir(), "gji-hooks-"));
		const markerFile = join(dir, "argv-hook-ran.txt");
		const stderr: string[] = [];
		const script = 'require("node:fs").writeFileSync(process.argv[1], "ok")';

		// When runHook is called with an argv command.
		await runHook(
			[process.execPath, "-e", script, "argv-hook-ran.txt"],
			dir,
			{ path: dir, repo: "r" },
			(c) => stderr.push(c),
		);

		// Then the command runs in the hook cwd without errors.
		await expect(readFile(markerFile, "utf8")).resolves.toBe("ok");
		expect(stderr).toEqual([]);
	});

	it("interpolates template variables before running the command", async () => {
		// Given a hook command that uses {{branch}} and {{repo}} variables.
		const dir = await mkdtemp(join(tmpdir(), "gji-hooks-"));
		const outputFile = join(dir, "output.txt");
		const stderr: string[] = [];

		// When runHook is called with branch and repo in context.
		await runHook(
			`printf '%s:%s' '{{branch}}' '{{repo}}' > "${outputFile}"`,
			dir,
			{ branch: "feature/test", path: dir, repo: "myrepo" },
			(c) => stderr.push(c),
		);

		// Then the output file contains the substituted values.
		await expect(readFile(outputFile, "utf8")).resolves.toBe(
			"feature/test:myrepo",
		);
	});

	it("passes interpolated argv template values without shell evaluation", async () => {
		// Given an argv hook and a branch value containing shell metacharacters.
		const dir = await mkdtemp(join(tmpdir(), "gji-hooks-"));
		const outputFile = join(dir, "argv-output.txt");
		const injectedFile = join(dir, "injected.txt");
		const branchName = `feature/safe; touch "${injectedFile}"`;
		const stderr: string[] = [];
		const script =
			'require("node:fs").writeFileSync(process.argv[1], process.argv[2])';

		// When runHook interpolates the branch into one argv argument.
		await runHook(
			[process.execPath, "-e", script, outputFile, "{{branch}}"],
			dir,
			{ branch: branchName, path: dir, repo: "myrepo" },
			(c) => stderr.push(c),
		);

		// Then the value is passed literally and the injected shell command does not run.
		await expect(readFile(outputFile, "utf8")).resolves.toBe(branchName);
		await expect(readFile(injectedFile)).rejects.toThrow();
		expect(stderr).toEqual([]);
	});

	it("exposes context as GJI_* environment variables", async () => {
		// Given a hook that writes the GJI_* env vars to a file.
		const dir = await mkdtemp(join(tmpdir(), "gji-hooks-"));
		const outputFile = join(dir, "env.txt");
		const stderr: string[] = [];

		// When runHook is called with branch, path and repo in context.
		await runHook(
			`printf '%s:%s:%s' "$GJI_BRANCH" "$GJI_PATH" "$GJI_REPO" > "${outputFile}"`,
			dir,
			{ branch: "feature/env", path: dir, repo: "myrepo" },
			(c) => stderr.push(c),
		);

		// Then the output file contains the values from the env vars.
		await expect(readFile(outputFile, "utf8")).resolves.toBe(
			`feature/env:${dir}:myrepo`,
		);
	});

	it("emits a warning on non-zero exit without throwing", async () => {
		// Given a hook command that exits with a non-zero code.
		const dir = await mkdtemp(join(tmpdir(), "gji-hooks-"));
		const stderr: string[] = [];

		// When runHook runs that failing command.
		await expect(
			runHook("exit 42", dir, { path: dir, repo: "r" }, (c) => stderr.push(c)),
		).resolves.toBeUndefined();

		// Then a warning mentioning the exit code is emitted to stderr.
		expect(stderr.join("")).toContain("hook exited with code 42");
	});
});

describe("hook config layering", () => {
	it("merges global and project hooks so both apply when they use different keys", async () => {
		// Given a global config with after-enter and a project config with after-create.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const branchName = "feature/layered-hooks";
		const worktreePath = resolveWorktreePath(repoRoot, branchName);
		const localMarker = join(worktreePath, ".local-hook-ran");
		process.env.HOME = home;

		const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
		await mkdir(dirname(globalConfigPath), { recursive: true });
		await writeFile(
			globalConfigPath,
			JSON.stringify({ hooks: { "after-enter": "echo enter" } }),
			"utf8",
		);
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ hooks: { "after-create": `touch "${localMarker}"` } }),
			"utf8",
		);

		// When gji new is run.
		const result = await runCli(["new", branchName], { cwd: repoRoot });

		// Then the project after-create hook ran and the global after-enter was not discarded.
		expect(result.exitCode).toBe(0);
		await expect(readFile(localMarker)).resolves.toBeDefined();
	});

	it("project hook overrides global hook for the same key", async () => {
		// Given global and project configs that both define after-create with different commands.
		const home = await mkdtemp(join(tmpdir(), "gji-home-"));
		const repoRoot = await createRepository();
		const branchName = "feature/override-hook";
		const worktreePath = resolveWorktreePath(repoRoot, branchName);
		const globalMarker = join(worktreePath, ".global-ran");
		const localMarker = join(worktreePath, ".local-ran");
		process.env.HOME = home;

		const globalConfigPath = GLOBAL_CONFIG_FILE_PATH(home);
		await mkdir(dirname(globalConfigPath), { recursive: true });
		await writeFile(
			globalConfigPath,
			JSON.stringify({ hooks: { "after-create": `touch "${globalMarker}"` } }),
			"utf8",
		);
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ hooks: { "after-create": `touch "${localMarker}"` } }),
			"utf8",
		);

		// When gji new is run.
		const result = await runCli(["new", branchName], { cwd: repoRoot });

		// Then only the project hook ran and the global hook for the same key did not.
		expect(result.exitCode).toBe(0);
		await expect(readFile(localMarker)).resolves.toBeDefined();
		await expect(readFile(globalMarker)).rejects.toThrow();
	});
});

describe("gji new with after-create hook", () => {
	it("runs the configured after-create hook in the new worktree directory", async () => {
		// Given a project config with an after-create hook that creates a marker file.
		const repoRoot = await createRepository();
		const branchName = "feature/hook-test";
		const worktreePath = resolveWorktreePath(repoRoot, branchName);
		const markerFile = join(worktreePath, ".hook-ran");

		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ hooks: { "after-create": `touch "${markerFile}"` } }),
			"utf8",
		);

		// When gji new creates the worktree.
		const result = await runCli(["new", branchName], { cwd: repoRoot });

		// Then the hook ran and the marker file exists inside the new worktree.
		expect(result.exitCode).toBe(0);
		await expect(readFile(markerFile)).resolves.toBeDefined();
	});

	it("still creates the worktree when the after-create hook fails", async () => {
		// Given a project config with an after-create hook that exits non-zero.
		const repoRoot = await createRepository();
		const branchName = "feature/hook-fail";
		const worktreePath = resolveWorktreePath(repoRoot, branchName);
		const stderr: string[] = [];

		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ hooks: { "after-create": "exit 1" } }),
			"utf8",
		);

		// When gji new runs with that failing hook.
		const result = await runCli(["new", branchName], {
			cwd: repoRoot,
			stderr: (c) => stderr.push(c),
		});

		// Then the worktree is still created and a warning is emitted.
		expect(result.exitCode).toBe(0);
		await expect(readFile(join(worktreePath, ".git"))).resolves.toBeDefined();
		expect(stderr.join("")).toContain("hook exited with code 1");
	});
});

describe("gji pr with after-create hook", () => {
	it("runs the configured after-create hook after checking out a PR worktree", async () => {
		// Given a repository with an origin remote exposing a PR ref and an after-create hook.
		const { repoRoot } = await createRepositoryWithOrigin();
		await runGit(repoRoot, ["checkout", "-b", "feature/pr-source"]);
		await commitFile(repoRoot, "pr.txt", "change\n", "pr commit");
		await pushPullRequestRef(repoRoot, "1");
		await runGit(repoRoot, ["checkout", "-"]);

		const worktreePath = resolveWorktreePath(repoRoot, "pr/1");
		const markerFile = join(worktreePath, ".hook-ran");

		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ hooks: { "after-create": `touch "${markerFile}"` } }),
			"utf8",
		);

		// When gji pr fetches and creates the PR worktree.
		const result = await runCli(["pr", "1"], { cwd: repoRoot });

		// Then the after-create hook ran inside the new PR worktree.
		expect(result.exitCode).toBe(0);
		await expect(readFile(markerFile)).resolves.toBeDefined();
	});
});

describe("gji done with before-remove hook", () => {
	it("runs the configured before-remove hook before removing the worktree", async () => {
		// Given an existing worktree and a project config with a before-remove hook.
		const repoRoot = await createRepository();
		const branchName = "feature/to-remove";
		const markerFile = join(repoRoot, "before-remove-ran.txt");

		await runCli(["new", branchName], { cwd: repoRoot });
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({ hooks: { "before-remove": `touch "${markerFile}"` } }),
			"utf8",
		);

		// When gji done is run for that worktree.
		const result = await runCli(["done", "--force", branchName], {
			cwd: repoRoot,
		});

		// Then the hook ran before removal and the marker file exists.
		expect(result.exitCode).toBe(0);
		await expect(readFile(markerFile)).resolves.toBeDefined();
	});
});

async function writeLifecycleLogHooks(repoRoot: string): Promise<string> {
	const logFile = join(await mkdtemp(join(tmpdir(), "gji-hook-log-")), "log");
	const logHook = (name: string) =>
		`printf '%s %s %s\\n' ${name} "$GJI_BRANCH" "$PWD" >> "${logFile}"`;
	await writeFile(
		join(repoRoot, ".gji.json"),
		JSON.stringify({
			hooks: {
				"after-branch-create": logHook("after-branch-create"),
				"after-create": logHook("after-create"),
				"after-enter": logHook("after-enter"),
				"after-switch": logHook("after-switch"),
			},
		}),
		"utf8",
	);
	return logFile;
}

async function readLifecycleLog(logFile: string): Promise<string[]> {
	return (await readFile(logFile, "utf8")).trim().split("\n");
}

describe("branch lifecycle hooks", () => {
	it("runs after-create then after-branch-create when gji new creates a branch and worktree", async () => {
		// Given a repository with every lifecycle hook logging its name.
		const repoRoot = await createRepository();
		const branchName = "feature/lifecycle-new";
		const worktreePath = resolveWorktreePath(repoRoot, branchName);
		const logFile = await writeLifecycleLogHooks(repoRoot);

		// When gji new creates a new branch in a new worktree.
		const result = await runCli(["new", "--no-fetch", branchName], {
			cwd: repoRoot,
		});

		// Then worktree setup runs before the branch hook, both inside the worktree.
		expect(result.exitCode).toBe(0);
		await expect(readLifecycleLog(logFile)).resolves.toEqual([
			`after-create ${branchName} ${worktreePath}`,
			`after-branch-create ${branchName} ${worktreePath}`,
		]);
	});

	it("skips after-branch-create when gji new checks out an existing branch", async () => {
		// Given an existing local branch without a worktree.
		const repoRoot = await createRepository();
		const branchName = "feature/lifecycle-existing";
		await runGit(repoRoot, ["branch", branchName]);
		const logFile = await writeLifecycleLogHooks(repoRoot);

		// When gji new creates a worktree for that branch.
		const result = await runCli(["new", "--no-fetch", branchName], {
			cwd: repoRoot,
		});

		// Then only the worktree hook runs.
		expect(result.exitCode).toBe(0);
		await expect(readLifecycleLog(logFile)).resolves.toEqual([
			`after-create ${branchName} ${resolveWorktreePath(repoRoot, branchName)}`,
		]);
	});

	it("runs after-branch-create then after-switch for gji new --branch-only", async () => {
		// Given a linked worktree and every lifecycle hook logging its name.
		const { repoRoot } = await createRepositoryWithOrigin();
		const currentWorktree = await addLinkedWorktree(
			repoRoot,
			"feature/lifecycle-current",
		);
		const branchName = "feature/lifecycle-in-place";
		const logFile = await writeLifecycleLogHooks(repoRoot);

		// When gji new creates a branch in the current worktree.
		const result = await runCli(["new", "--branch-only", branchName], {
			cwd: currentWorktree,
			stdout: () => undefined,
		});

		// Then branch hooks run in the current worktree without worktree setup.
		expect(result.exitCode).toBe(0);
		await expect(readLifecycleLog(logFile)).resolves.toEqual([
			`after-branch-create ${branchName} ${currentWorktree}`,
			`after-switch ${branchName} ${currentWorktree}`,
		]);
	});
});

describe("gji clean with before-remove hook", () => {
	it("runs the configured before-remove hook for each removed worktree", async () => {
		// Given two linked worktrees and a before-remove hook that logs each branch.
		const repoRoot = await createRepository();
		const logFile = join(await mkdtemp(join(tmpdir(), "gji-hook-log-")), "log");
		await addLinkedWorktree(repoRoot, "feature/clean-hook-a");
		await addLinkedWorktree(repoRoot, "feature/clean-hook-b");
		await writeFile(
			join(repoRoot, ".gji.json"),
			JSON.stringify({
				hooks: { "before-remove": `echo "$GJI_BRANCH" >> "${logFile}"` },
			}),
			"utf8",
		);

		// When gji clean removes every linked worktree.
		const result = await runCli(["clean", "--force"], {
			cwd: repoRoot,
			stderr: () => undefined,
			stdout: () => undefined,
		});

		// Then the hook ran once per removed worktree.
		expect(result.exitCode).toBe(0);
		const logged = (await readFile(logFile, "utf8")).trim().split("\n");
		expect(logged.sort()).toEqual([
			"feature/clean-hook-a",
			"feature/clean-hook-b",
		]);
	});
});
