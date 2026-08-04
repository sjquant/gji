import { chmod, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	executeDependencyBootstrap,
	prepareDependencyBootstrap,
	previewDependencyBootstrap,
} from "./dependency-bootstrap.js";

function createReporter() {
	const events: string[] = [];
	return {
		dependency: (event: { state: string; message: string }) => {
			events.push(`${event.state}:${event.message}`);
		},
		events,
	};
}

async function writeUvInterpreter(
	worktreePath: string,
	prefix: string,
): Promise<string> {
	const bin = join(worktreePath, ".venv", "bin");
	await mkdir(bin, { recursive: true });
	const interpreter = join(bin, "python");
	await writeFile(interpreter, `#!/bin/sh\nprintf '%s\\n' '${prefix}'\n`);
	await chmod(interpreter, 0o755);
	return bin;
}

describe("dependency bootstrap", () => {
	it("previews direct install for a repository with a dependency tree", async () => {
		// Given a repository with a lockfile and a source dependency directory.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-repo-"));
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-worktree-"),
		);
		await writeFile(join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9'\n");
		await mkdir(join(repoRoot, "node_modules"));

		// When the dependency plan is prepared and previewed.
		const plan = await prepareDependencyBootstrap("install", {
			repoRoot,
			worktreePath,
		});
		// Then the only advertised action is the authoritative package-manager install.
		expect(previewDependencyBootstrap(plan).targets).toEqual([
			expect.objectContaining({
				adapter: "pnpm",
				command: "pnpm install --frozen-lockfile",
			}),
		]);
	});

	it.each([
		{
			adapter: "yarn",
			command: "yarn install --immutable",
			lockfile: "yarn.lock",
			state: "installed",
			yarnBerry: true,
		},
		{
			adapter: "yarn",
			command: "yarn install --frozen-lockfile",
			lockfile: "yarn.lock",
			state: "installed",
			yarnBerry: false,
		},
		{
			adapter: "bun",
			command: "bun install --frozen-lockfile",
			lockfile: "bun.lock",
			state: "installed",
		},
		{
			adapter: "bun",
			command: "bun install --frozen-lockfile",
			lockfile: "bun.lockb",
			state: "installed",
		},
		{
			adapter: "npm",
			command: "npm ci",
			lockfile: "package-lock.json",
			state: "installed",
		},
		{
			adapter: "bundler",
			command: "bundle install",
			lockfile: "Gemfile.lock",
			state: "installed",
		},
		{
			adapter: "cargo",
			command: "cargo build --workspace",
			lockfile: "Cargo.lock",
			state: "installed",
			cargoBuildCommand: "cargo build --workspace",
		},
		{
			adapter: "go",
			command: "go mod download",
			lockfile: "go.mod",
			state: "installed",
		},
		{
			adapter: "composer",
			command: "composer install --no-interaction --prefer-dist",
			lockfile: "composer.lock",
			state: "installed",
		},
		{
			adapter: "poetry",
			command: "poetry install --no-interaction",
			lockfile: "poetry.lock",
			state: "installed",
			envKey: "POETRY_VIRTUALENVS_IN_PROJECT",
			envValue: "true",
		},
		{
			adapter: "pipenv",
			command: "pipenv sync",
			lockfile: "Pipfile.lock",
			state: "installed",
			envKey: "PIPENV_VENV_IN_PROJECT",
			envValue: "1",
		},
	])("runs the $adapter install command directly", async ({
		adapter,
		command,
		lockfile,
		state,
		cargoBuildCommand,
		envKey,
		envValue,
		yarnBerry,
	}) => {
		// Given a repository with one adapter lockfile and an empty worktree target.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-repo-"));
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-worktree-"),
		);
		await writeFile(join(repoRoot, lockfile), "lockfile\n");
		if (adapter === "yarn" && yarnBerry) {
			await writeFile(
				join(repoRoot, ".yarnrc.yml"),
				"nodeLinker: node-modules\n",
			);
		}
		const invocations: Array<{
			command: string;
			options: { env?: NodeJS.ProcessEnv; shell?: boolean } | undefined;
		}> = [];
		const reporter = createReporter();
		const plan = await prepareDependencyBootstrap("install", {
			cargoBuildCommand,
			repoRoot,
			worktreePath,
		});

		// When bootstrap executes through the public command-runner boundary.
		const result = await executeDependencyBootstrap(plan, {
			reporter,
			runCommand: async (runCommand, _cwd, _stderr, _stdout, options) => {
				invocations.push({ command: runCommand, options });
			},
		});

		// Then the adapter's command and lifecycle state remain explicit.
		expect(result.ready).toBe(true);
		expect(invocations.map(({ command: actual }) => actual)).toEqual([command]);
		expect(result.events.map(({ state }) => state)).toEqual([state]);
		if (adapter === "bundler") {
			expect(invocations[0]?.options?.env).toMatchObject({
				BUNDLE_PATH: "vendor/bundle",
			});
		}
		if (envKey) {
			expect(invocations[0]?.options?.env).toMatchObject({
				[envKey]: envValue,
			});
		}
	});

	it("runs uv sync and validates the installed environment", async () => {
		// Given a repository with a locked uv environment and a fresh worktree.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-repo-"));
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-worktree-"),
		);
		await writeFile(join(repoRoot, "uv.lock"), "version = 1\n");
		const commands: string[] = [];
		const reporter = createReporter();
		const plan = await prepareDependencyBootstrap("install", {
			repoRoot,
			worktreePath,
		});
		const expectedVenv = join(worktreePath, ".venv");

		// When the uv install command creates a minimal relocatable interpreter.
		const result = await executeDependencyBootstrap(plan, {
			reporter,
			runCommand: async (command, cwd) => {
				commands.push(command);
				await writeUvInterpreter(cwd, expectedVenv);
			},
		});

		// Then uv setup completes only after its relocation checks pass.
		expect(result).toMatchObject({
			ready: true,
			events: [expect.objectContaining({ state: "installed" })],
		});
		expect(commands).toEqual(["uv sync --locked"]);
		expect(reporter.events).toEqual([
			"installed:installed into a clean target",
		]);
	});

	it("fails when a uv launcher retains the source environment path", async () => {
		// Given a locked uv project whose generated activation script points at the source worktree.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-repo-"));
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-worktree-"),
		);
		await writeFile(join(repoRoot, "uv.lock"), "version = 1\n");
		const plan = await prepareDependencyBootstrap("install", {
			repoRoot,
			worktreePath,
		});
		const reporter = createReporter();

		// When uv creates a launcher containing the source environment path.
		const result = await executeDependencyBootstrap(plan, {
			reporter,
			runCommand: async (_command, cwd) => {
				const bin = await writeUvInterpreter(cwd, join(cwd, ".venv"));
				await writeFile(
					join(bin, "activate"),
					`VIRTUAL_ENV="${join(repoRoot, ".venv")}"\n`,
				);
			},
		});

		// Then setup fails closed instead of leaving a launcher tied to another worktree.
		expect(result.ready).toBe(false);
		expect(reporter.events[0]).toContain(
			"uv environment contains a stale source path",
		);
	});

	it("fails when a uv environment contains an unsafe script symlink", async () => {
		// Given a locked uv project with a fresh target environment.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-repo-"));
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-worktree-"),
		);
		await writeFile(join(repoRoot, "uv.lock"), "version = 1\n");
		const plan = await prepareDependencyBootstrap("install", {
			repoRoot,
			worktreePath,
		});
		const reporter = createReporter();

		// When uv creates a non-interpreter symlink inside its scripts directory.
		const result = await executeDependencyBootstrap(plan, {
			reporter,
			runCommand: async (_command, cwd) => {
				const bin = await writeUvInterpreter(cwd, join(cwd, ".venv"));
				await writeFile(join(bin, "activate-target"), "activate\n");
				await symlink(join(bin, "activate-target"), join(bin, "activate-link"));
			},
		});

		// Then setup fails closed rather than accepting an unsafe launcher entry.
		expect(result.ready).toBe(false);
		expect(reporter.events[0]).toContain(
			"uv script must not be a symbolic link",
		);
	});

	it("installs independent dependency targets in one worktree", async () => {
		// Given a repository containing JavaScript, Go, and Rust dependency manifests.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-repo-"));
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-worktree-"),
		);
		await writeFile(join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9'\n");
		await writeFile(join(repoRoot, "go.mod"), "module example.test\n");
		await writeFile(join(repoRoot, "Cargo.lock"), "version = 3\n");
		const commands: string[] = [];
		const plan = await prepareDependencyBootstrap("install", {
			repoRoot,
			worktreePath,
		});

		// When the public bootstrap executor runs all detected adapters.
		const result = await executeDependencyBootstrap(plan, {
			reporter: createReporter(),
			runCommand: async (command) => {
				commands.push(command);
			},
		});

		// Then each independent target is installed without copying another target.
		expect(result.ready).toBe(true);
		expect(commands).toEqual([
			"pnpm install --frozen-lockfile",
			"go mod download",
			"cargo check",
		]);
	});

	it("installs into a clean target when a new worktree has no dependency tree", async () => {
		// Given a pnpm lockfile and a fresh worktree.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-repo-"));
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-worktree-"),
		);
		await writeFile(join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9'\n");
		const commands: string[] = [];
		const reporter = createReporter();
		const plan = await prepareDependencyBootstrap("install", {
			repoRoot,
			worktreePath,
		});

		// When bootstrap runs with a public command runner.
		const result = await executeDependencyBootstrap(plan, {
			reporter,
			runCommand: async (command) => {
				commands.push(command);
			},
		});

		// Then it runs install once and reports the direct install result.
		expect(result.ready).toBe(true);
		expect(commands).toEqual(["pnpm install --frozen-lockfile"]);
		expect(reporter.events).toEqual([
			"installed:installed into a clean target",
		]);
	});

	it("does not retry or delete a target when install fails", async () => {
		// Given a package-manager lockfile and an install command that fails.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-repo-"));
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-worktree-"),
		);
		await writeFile(join(repoRoot, "package-lock.json"), "{}\n");
		const reporter = createReporter();
		const plan = await prepareDependencyBootstrap("install", {
			repoRoot,
			worktreePath,
		});

		// When bootstrap executes the failing command.
		const result = await executeDependencyBootstrap(plan, {
			reporter,
			runCommand: async () => {
				throw new Error("network unavailable");
			},
		});

		// Then the failure is reported directly without a fallback copy or retry.
		expect(result.ready).toBe(false);
		expect(reporter.events).toEqual([
			"failed:install failed: network unavailable",
		]);
	});
});
