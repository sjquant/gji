import {
	access,
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	executeDependencyBootstrap,
	prepareDependencyBootstrap,
	previewDependencyBootstrap,
} from "./dependency-bootstrap.js";
import {
	CloneDestinationExistsError,
	CloneUnsupportedError,
} from "./dir-clone.js";
import { addLinkedWorktree, createRepository } from "./repo.test-helpers.js";

function createReporter() {
	const events: string[] = [];
	return {
		measureCloneSize: false,
		write: () => undefined,
		cloned: () => undefined,
		dependency: (event: { state: string; message: string }) => {
			events.push(`${event.state}:${event.message}`);
		},
		events,
	};
}

async function writeUvTestInterpreter(
	venvPath: string,
	prefix: string,
): Promise<void> {
	const bin = join(venvPath, "bin");
	await mkdir(bin, { recursive: true });
	const interpreter = join(bin, "python");
	await writeFile(interpreter, `#!/bin/sh\nprintf '%s\\n' '${prefix}'\n`);
	await chmod(interpreter, 0o755);
}

async function prepareNodePlan(
	mode: "cow-then-repair" | "install-only",
): Promise<{
	repoRoot: string;
	worktreePath: string;
	plan: Awaited<ReturnType<typeof prepareDependencyBootstrap>>;
}> {
	const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-repo-"));
	const worktreePath = await mkdtemp(join(tmpdir(), "gji-bootstrap-worktree-"));
	await writeFile(join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9'\n");
	await mkdir(join(repoRoot, "node_modules"));

	const plan = await prepareDependencyBootstrap(mode, {
		repoRoot,
		worktreePath,
	});
	return { repoRoot, worktreePath, plan };
}

describe("dependencyBootstrap adapters", () => {
	it("selects an eligible linked worktree as the seed source", async () => {
		// Given a repository whose lockfile and seed exist only in the current linked worktree.
		const repoRoot = await createRepository();
		const currentRoot = await addLinkedWorktree(
			repoRoot,
			"feature/bootstrap-source",
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-current-source-worktree-"),
		);
		await writeFile(
			join(currentRoot, "pnpm-lock.yaml"),
			"lockfileVersion: '9'\n",
		);
		await mkdir(join(currentRoot, "node_modules"));

		// When the dependency plan is prepared with both repository roots.
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			currentRoot,
			repoRoot,
			worktreePath,
		});

		// Then the eligible current worktree supplies the CoW seed.
		expect(plan.targets[0]?.target.sourceRoot).toBe(currentRoot);
		expect(plan.targets[0]?.target.adapter).toBe("pnpm");
	});

	it("reports npm as install-only in the effective dry-run strategy", async () => {
		// Given an npm lockfile and cow-then-repair configuration.
		const repoRoot = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-npm-preview-repo-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-npm-preview-worktree-"),
		);
		await writeFile(join(repoRoot, "package-lock.json"), "{}\n");

		// When the bootstrap plan is previewed.
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			repoRoot,
			worktreePath,
		});

		// Then the preview describes the same install-only behavior as execution.
		expect(previewDependencyBootstrap(plan).targets).toEqual([
			expect.objectContaining({
				adapter: "npm",
				seedable: false,
				strategy: "install-only",
			}),
		]);
	});

	it("selects one package manager when multiple lockfiles share node_modules", async () => {
		// Given a repository containing pnpm and npm lockfiles with one dependency target.
		const repoRoot = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-multi-manager-repo-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-multi-manager-worktree-"),
		);
		await writeFile(join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9'\n");
		await writeFile(join(repoRoot, "package-lock.json"), "{}\n");
		await mkdir(join(repoRoot, "node_modules"));

		// When the dependency plan is prepared.
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			repoRoot,
			worktreePath,
		});

		// Then the highest-priority adapter owns node_modules exclusively.
		expect(plan.targets).toHaveLength(1);
		expect(plan.targets[0]?.target.adapter).toBe("pnpm");
		expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
	});

	it("seeds node_modules with CoW and always runs the frozen pnpm repair", async () => {
		// Given a pnpm source with a reusable dependency tree and a fresh worktree.
		const { worktreePath, plan } = await prepareNodePlan("cow-then-repair");
		const reporter = createReporter();
		const commands: string[] = [];

		// When dependency bootstrap executes with an injected CoW clone and repair runner.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				await mkdir(destination, { recursive: true });
				await writeFile(join(destination, ".modules.yaml"), "stale\n");
				return { bytes: 1, ms: 1 };
			},
			reporter,
			runCommand: async (command, cwd) => {
				commands.push(command);
				await expect(
					readFile(join(cwd, "node_modules", ".modules.yaml"), "utf8"),
				).rejects.toThrow();
				await mkdir(join(cwd, "node_modules"), { recursive: true });
				await writeFile(
					join(cwd, "node_modules", ".modules.yaml"),
					"regenerated\n",
				);
			},
		});

		// Then cloning is a seed only, pnpm repair runs, and metadata is regenerated by the repair.
		expect(result.ready).toBe(true);
		expect(commands).toEqual(["pnpm install --frozen-lockfile"]);
		expect(result.events.map(({ state }) => state)).toEqual([
			"seeded",
			"repaired",
		]);
		await expect(
			readFile(join(worktreePath, "node_modules", ".modules.yaml"), "utf8"),
		).resolves.toBe("regenerated\n");
	});

	it("makes Yarn re-evaluate cloned native build state", async () => {
		// Given a Yarn dependency tree carrying build-state metadata from its source.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-yarn-repo-"));
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-yarn-worktree-"),
		);
		await writeFile(join(repoRoot, "yarn.lock"), "__metadata:\n  version: 8\n");
		await mkdir(join(repoRoot, "node_modules"));
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			repoRoot,
			worktreePath,
		});
		let statePresent = true;

		// When the cloned tree is repaired for the new worktree runtime.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				await mkdir(destination);
				await writeFile(join(destination, ".yarn-state.yml"), "stale\n");
				return { ms: 1 };
			},
			reporter: createReporter(),
			runCommand: async () => {
				statePresent = await access(
					join(worktreePath, "node_modules", ".yarn-state.yml"),
				).then(
					() => true,
					() => false,
				);
			},
		});

		// Then Yarn sees no stale build-state marker and performs its immutable repair.
		expect(result.ready).toBe(true);
		expect(statePresent).toBe(false);
		expect(result.events.map(({ state }) => state)).toEqual([
			"seeded",
			"repaired",
		]);
	});

	it("uses npm install-only and never attempts a CoW seed", async () => {
		// Given an npm lockfile and no dependency target in a new worktree.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-npm-repo-"));
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-npm-worktree-"),
		);
		await writeFile(join(repoRoot, "package-lock.json"), "{}\n");
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			repoRoot,
			worktreePath,
		});
		const reporter = createReporter();
		let cloneCalled = false;
		const commands: string[] = [];

		// When dependency bootstrap executes for npm.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async () => {
				cloneCalled = true;
				return { ms: 1 };
			},
			reporter,
			runCommand: async (command) => {
				commands.push(command);
			},
		});

		// Then npm runs destructive install-only repair and no clone is attempted.
		expect(result.ready).toBe(true);
		expect(cloneCalled).toBe(false);
		expect(commands).toEqual(["npm ci"]);
		expect(result.events.at(-1)?.state).toBe("installed");
	});

	it("uses npm install when node_modules appears after planning", async () => {
		// Given an npm plan prepared for a clean target that becomes populated before execution.
		const repoRoot = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-npm-race-repo-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-npm-race-worktree-"),
		);
		await writeFile(join(repoRoot, "package-lock.json"), "{}\n");
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			repoRoot,
			worktreePath,
		});
		await mkdir(join(worktreePath, "node_modules"));
		await writeFile(join(worktreePath, "node_modules", "keep.txt"), "keep\n");
		const commands: string[] = [];

		// When bootstrap chooses the npm command at repair time.
		const result = await executeDependencyBootstrap(plan, {
			reporter: createReporter(),
			runCommand: async (command) => {
				commands.push(command);
			},
		});

		// Then it preserves the late target and avoids the destructive clean install.
		expect(result.ready).toBe(true);
		expect(commands).toEqual(["npm install"]);
		await expect(
			readFile(join(worktreePath, "node_modules", "keep.txt"), "utf8"),
		).resolves.toBe("keep\n");
	});

	it("preserves output created by a failed clean package-manager repair", async () => {
		// Given an npm repair planned for an absent dependency target.
		const repoRoot = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-npm-failure-repo-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-npm-failure-worktree-"),
		);
		await writeFile(join(repoRoot, "package-lock.json"), "{}\n");
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			repoRoot,
			worktreePath,
		});

		// When the package manager creates output and then fails.
		const result = await executeDependencyBootstrap(plan, {
			reporter: createReporter(),
			runCommand: async () => {
				await mkdir(join(worktreePath, "node_modules"));
				await writeFile(
					join(worktreePath, "node_modules", "diagnostic.txt"),
					"keep\n",
				);
				throw new Error("npm failed");
			},
		});

		// Then gji reports the failure without recursively deleting untracked output.
		expect(result.ready).toBe(false);
		await expect(
			readFile(join(worktreePath, "node_modules", "diagnostic.txt"), "utf8"),
		).resolves.toBe("keep\n");
	});

	it("seeds only project-local Bundler state and repairs it deterministically", async () => {
		// Given a Ruby project with a locked bundle and a project-local vendor/bundle tree.
		const repoRoot = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-bundler-repo-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-bundler-worktree-"),
		);
		await writeFile(join(repoRoot, "Gemfile.lock"), "GEM\n  specs:\n");
		await mkdir(join(repoRoot, "vendor", "bundle"), { recursive: true });

		// When the Bundler adapter is planned and executed with an injected CoW runner.
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			repoRoot,
			worktreePath,
		});
		const commands: string[] = [];
		const commandOptions: unknown[] = [];
		let buildMarkerPresent = true;
		let packagedFilePresent = false;
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				const extension = join(
					destination,
					"ruby",
					"3.4.0",
					"extensions",
					"arm64-darwin",
					"3.4.0",
					"example-1.0.0",
				);
				const packaged = join(
					destination,
					"ruby",
					"3.4.0",
					"gems",
					"example-1.0.0",
					"lib",
					"extensions",
				);
				await mkdir(extension, { recursive: true });
				await mkdir(packaged, { recursive: true });
				await writeFile(join(extension, "gem.build_complete"), "built\n");
				await writeFile(join(packaged, "gem.build_complete"), "packaged\n");
				return { ms: 1 };
			},
			reporter: createReporter(),
			runCommand: async (command, _cwd, _stderr, _stdout, options) => {
				commands.push(command);
				commandOptions.push(options);
				buildMarkerPresent = await access(
					join(
						worktreePath,
						"vendor/bundle/ruby/3.4.0/extensions/arm64-darwin/3.4.0/example-1.0.0/gem.build_complete",
					),
				).then(
					() => true,
					() => false,
				);
				packagedFilePresent = await access(
					join(
						worktreePath,
						"vendor/bundle/ruby/3.4.0/gems/example-1.0.0/lib/extensions/gem.build_complete",
					),
				).then(
					() => true,
					() => false,
				);
			},
		});

		// Then only vendor/bundle is seeded and bundle install repairs the worktree.
		expect(plan.targets).toHaveLength(1);
		expect(plan.targets[0]?.target.adapter).toBe("bundler");
		expect(plan.targets[0]?.target.relativePath).toBe("vendor/bundle");
		expect(result.ready).toBe(true);
		expect(buildMarkerPresent).toBe(false);
		expect(packagedFilePresent).toBe(true);
		expect(commands).toEqual(["bundle install"]);
		expect(commandOptions).toEqual([
			{ env: { BUNDLE_PATH: "vendor/bundle" }, shell: false },
		]);
	});

	it("retries CoW on later bootstraps after an unsupported seed", async () => {
		// Given a pnpm source whose filesystem rejects every forced CoW attempt.
		const { plan } = await prepareNodePlan("cow-then-repair");
		let cloneCalls = 0;
		let repairCalls = 0;
		const cloneDirectory = async () => {
			cloneCalls += 1;
			throw new CloneUnsupportedError("reflinks unavailable");
		};
		const execute = () =>
			executeDependencyBootstrap(plan, {
				cloneDirectory,
				reporter: createReporter(),
				runCommand: async () => {
					repairCalls += 1;
				},
			});

		// When the same bootstrap is executed again after repair-only fallback.
		const first = await execute();
		const second = await execute();

		// Then each run retries CoW, never performs an ordinary copy, and repairs cleanly.
		expect(first.ready).toBe(true);
		expect(second.ready).toBe(true);
		expect(cloneCalls).toBe(2);
		expect(repairCalls).toBe(2);
		expect(first.events.map(({ state }) => state)).toEqual([
			"repair-only",
			"repaired",
		]);
	});

	it("preserves package-manager metadata that appears during CoW seeding", async () => {
		// Given a fresh target whose pnpm metadata is published by another process.
		const { worktreePath, plan } = await prepareNodePlan("cow-then-repair");
		const reporter = createReporter();

		// When the cloner reports that the destination appeared after creating it.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				await mkdir(destination, { recursive: true });
				await writeFile(join(destination, ".modules.yaml"), "keep\n");
				throw new CloneDestinationExistsError(destination);
			},
			reporter,
			runCommand: async () => undefined,
		});

		// Then repair uses the published target without deleting its metadata.
		expect(result.ready).toBe(true);
		await expect(
			readFile(join(worktreePath, "node_modules", ".modules.yaml"), "utf8"),
		).resolves.toBe("keep\n");
		expect(result.events.map(({ state }) => state)).toEqual([
			"skipped",
			"repaired",
		]);
	});

	it("preserves a dirty target left by a failed CoW publisher", async () => {
		// Given a clone implementation that leaves a partial target before reporting failure.
		const { worktreePath, plan } = await prepareNodePlan("cow-then-repair");

		// When repair also fails after bootstrap re-inspects the clone destination.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				await mkdir(destination, { recursive: true });
				await writeFile(join(destination, "external.txt"), "keep\n");
				throw new Error("publisher failed");
			},
			reporter: createReporter(),
			runCommand: async () => {
				throw new Error("repair failed");
			},
		});

		// Then the dirty destination is treated as preserved input and is never deleted.
		expect(result.ready).toBe(false);
		expect(result.events[0]).toMatchObject({
			state: "repair-only",
			message: expect.stringContaining("preserved target"),
		});
		await expect(
			readFile(join(worktreePath, "node_modules", "external.txt"), "utf8"),
		).resolves.toBe("keep\n");
	});

	it("removes a failed seed before retrying clean and preserves no partial clone", async () => {
		// Given a source whose first repair fails after a successful seed.
		const { worktreePath, plan } = await prepareNodePlan("cow-then-repair");
		const reporter = createReporter();
		let repairAttempts = 0;
		let targetExistedOnRetry = true;

		// When the first repair fails and the clean retry is allowed to run.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				await mkdir(destination, { recursive: true });
				await writeFile(join(destination, "partial.txt"), "partial\n");
				return { ms: 1 };
			},
			reporter,
			runCommand: async (_command, cwd) => {
				repairAttempts += 1;
				if (repairAttempts === 1) throw new Error("stale seed");
				targetExistedOnRetry = await pathExists(join(cwd, "node_modules"));
				await mkdir(join(cwd, "node_modules"), { recursive: true });
			},
		});

		// Then the retry sees a clean target and leaves a successful repaired worktree.
		expect(result.ready).toBe(true);
		expect(repairAttempts).toBe(2);
		expect(targetExistedOnRetry).toBe(false);
		await expect(
			readFile(join(worktreePath, "node_modules", "partial.txt"), "utf8"),
		).rejects.toThrow();
	});

	it("never deletes a target that existed before the bootstrap command", async () => {
		// Given a pre-existing dependency target with a user-owned sentinel file.
		const repoRoot = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-existing-repo-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-existing-worktree-"),
		);
		await writeFile(join(repoRoot, "pnpm-lock.yaml"), "lock\n");
		await mkdir(join(repoRoot, "node_modules"));
		await mkdir(join(worktreePath, "node_modules"));
		await writeFile(join(worktreePath, "node_modules", "keep.txt"), "keep\n");
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			repoRoot,
			worktreePath,
		});
		const reporter = createReporter();

		// When repair fails against the existing target.
		const result = await executeDependencyBootstrap(plan, {
			reporter,
			runCommand: async () => {
				throw new Error("repair failed");
			},
		});

		// Then bootstrap reports failure without removing user-owned state.
		expect(result.ready).toBe(false);
		await expect(
			readFile(join(worktreePath, "node_modules", "keep.txt"), "utf8"),
		).resolves.toBe("keep\n");
	});

	it("rejects a symlinked source outside the selected repository root", async () => {
		// Given a lockfile and a node_modules symlink that escapes the repository.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-link-repo-"));
		const external = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-link-external-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-link-worktree-"),
		);
		await writeFile(join(repoRoot, "pnpm-lock.yaml"), "lock\n");
		await mkdir(join(external, "package"));
		await symlink(external, join(repoRoot, "node_modules"));
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			repoRoot,
			worktreePath,
		});
		const reporter = createReporter();
		let cloneCalled = false;

		// When bootstrap evaluates the source.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async () => {
				cloneCalled = true;
				return { ms: 1 };
			},
			reporter,
			runCommand: async () => undefined,
		});

		// Then the unsafe source is skipped without cloning and repair remains the only fallback.
		expect(result.ready).toBe(true);
		expect(cloneCalled).toBe(false);
		expect(result.events[0]?.state).toBe("repair-only");
	});

	it("fails safely when a dependency destination points outside the worktree", async () => {
		// Given a dependency lockfile and an external node_modules destination.
		const repoRoot = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-destination-repo-"),
		);
		const external = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-destination-external-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-destination-worktree-"),
		);
		await writeFile(join(repoRoot, "pnpm-lock.yaml"), "lock\n");
		await symlink(external, join(worktreePath, "node_modules"));
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			repoRoot,
			worktreePath,
		});
		const reporter = createReporter();
		let repairCalled = false;

		// When dependency bootstrap evaluates and executes the unsafe target.
		const result = await executeDependencyBootstrap(plan, {
			reporter,
			runCommand: async () => {
				repairCalled = true;
			},
		});

		// Then setup fails without invoking the repair command or touching the external directory.
		expect(result.ready).toBe(false);
		expect(repairCalled).toBe(false);
		expect(result.events.at(-1)?.reason).toBe("destination-unsafe");
		expect(await access(external)).toBeUndefined();
	});

	it("clones a compatible uv environment and repairs it with locked sync", async () => {
		// Given a uv lockfile and a virtual environment with a compatible interpreter fingerprint.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-uv-repo-"));
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-uv-worktree-"),
		);
		await writeFile(join(repoRoot, "uv.lock"), "versioned\n");
		await mkdir(join(repoRoot, ".venv", "bin"), { recursive: true });
		await writeFile(join(repoRoot, ".venv", "pyvenv.cfg"), "version = 3.13\n");
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			checkUvRuntime: async () => true,
			repoRoot,
			worktreePath,
		});
		const commands: string[] = [];
		let relocatedScript = "";
		let systemScript = "";
		const previousEnvironment = join(tmpdir(), "previous-checkout", ".venv");
		const previousLauncher = `#!/bin/sh\n'''exec' '${join(
			previousEnvironment,
			"bin",
			"python",
		)}' "$0" "$@"\n' '''\n`;

		// When uv bootstrap runs.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				await mkdir(join(destination, "bin"), { recursive: true });
				await writeFile(join(destination, "bin", "tool"), previousLauncher);
				await writeFile(
					join(destination, "bin", "system-tool"),
					"#!/usr/bin/python\n",
				);
				return { ms: 1 };
			},
			reporter: createReporter(),
			runCommand: async (command) => {
				commands.push(command);
				await writeFile(
					join(worktreePath, ".venv", "bin", "tool"),
					previousLauncher
						.split(previousEnvironment)
						.join(join(worktreePath, ".venv")),
				);
				relocatedScript = await readFile(
					join(worktreePath, ".venv", "bin", "tool"),
					"utf8",
				);
				systemScript = await readFile(
					join(worktreePath, ".venv", "bin", "system-tool"),
					"utf8",
				);
				await writeUvTestInterpreter(
					join(worktreePath, ".venv"),
					join(worktreePath, ".venv"),
				);
			},
		});

		// Then uv reuses the environment only after the locked repair succeeds.
		expect(result.ready).toBe(true);
		expect(commands).toEqual(["uv sync --locked"]);
		expect(relocatedScript).toBe(
			previousLauncher
				.split(previousEnvironment)
				.join(join(worktreePath, ".venv")),
		);
		expect(systemScript).toBe("#!/usr/bin/python\n");
		expect(result.events.map(({ state }) => state)).toEqual([
			"seeded",
			"repaired",
		]);
	});

	it("accepts uv activation scripts whose PATH line reuses VIRTUAL_ENV", async () => {
		// Given a cloned uv environment with a valid Fish activation assignment and PATH update.
		const repoRoot = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-uv-fish-repo-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-uv-fish-worktree-"),
		);
		await writeFile(join(repoRoot, "uv.lock"), "versioned\n");
		await mkdir(join(repoRoot, ".venv", "bin"), { recursive: true });
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			checkUvRuntime: async () => true,
			repoRoot,
			worktreePath,
		});

		// When uv bootstrap validates the repaired activation scripts.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				await mkdir(join(destination, "bin"), { recursive: true });
				await writeFile(
					join(destination, "bin", "activate.fish"),
					[
						`set -gx VIRTUAL_ENV '${join(worktreePath, ".venv")}'`,
						`set -gx PATH "$VIRTUAL_ENV"'/bin' $PATH`,
						"",
					].join("\n"),
				);
				return { ms: 1 };
			},
			reporter: createReporter(),
			runCommand: async () =>
				writeUvTestInterpreter(
					join(worktreePath, ".venv"),
					join(worktreePath, ".venv"),
				),
		});

		// Then the valid activation script is accepted and the repaired environment is ready.
		expect(result.ready).toBe(true);
		expect(result.events.map(({ state }) => state)).toEqual([
			"seeded",
			"repaired",
		]);
	});

	it("rejects oversized uv launchers without reading them as validation text", async () => {
		// Given a seed containing a launcher larger than the bounded relocation budget.
		const repoRoot = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-uv-large-repo-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-uv-large-worktree-"),
		);
		await writeFile(join(repoRoot, "uv.lock"), "versioned\n");
		await mkdir(join(repoRoot, ".venv", "bin"), { recursive: true });
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			checkUvRuntime: async () => true,
			repoRoot,
			worktreePath,
		});
		let repairAttempts = 0;

		// When post-repair validation encounters the oversized regular file.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				await mkdir(join(destination, "bin"), { recursive: true });
				await writeFile(
					join(destination, "bin", "huge-tool"),
					"x".repeat(1024 * 1024 + 1),
				);
				return { ms: 1 };
			},
			reporter: createReporter(),
			runCommand: async () => {
				repairAttempts += 1;
				await writeUvTestInterpreter(
					join(worktreePath, ".venv"),
					join(worktreePath, ".venv"),
				);
			},
		});

		// Then the seed is discarded and a bounded clean repair succeeds.
		expect(result.ready).toBe(true);
		expect(repairAttempts).toBe(2);
		expect(result.events.map(({ state }) => state)).toEqual([
			"seeded",
			"repair-only",
			"repaired",
		]);
	});

	it("does not rewrite files through a symlinked uv scripts directory", async () => {
		// Given a cloned uv seed whose scripts directory points outside the worktree.
		const repoRoot = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-uv-link-repo-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-uv-link-worktree-"),
		);
		const external = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-uv-link-out-"),
		);
		const externalTool = join(external, "tool");
		await writeFile(join(repoRoot, "uv.lock"), "versioned\n");
		await mkdir(join(repoRoot, ".venv", "bin"), { recursive: true });
		await writeFile(
			externalTool,
			`#!${join(repoRoot, ".venv", "bin", "python")}\n`,
		);
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			checkUvRuntime: async () => true,
			repoRoot,
			worktreePath,
		});
		let repairAttempts = 0;

		// When relocation inspects the cloned environment before repair.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				await mkdir(destination, { recursive: true });
				await writeFile(join(destination, "pyvenv.cfg"), "version = 3.13\n");
				await symlink(external, join(destination, "bin"));
				return { ms: 1 };
			},
			reporter: createReporter(),
			runCommand: async () => {
				repairAttempts += 1;
				await writeUvTestInterpreter(
					join(worktreePath, ".venv"),
					join(worktreePath, ".venv"),
				);
			},
		});

		// Then the unsafe seed is discarded and the external script is untouched.
		expect(result.ready).toBe(true);
		expect(repairAttempts).toBe(1);
		await expect(readFile(externalTool, "utf8")).resolves.toBe(
			`#!${join(repoRoot, ".venv", "bin", "python")}\n`,
		);
		expect(result.events.map(({ state }) => state)).toEqual([
			"seeded",
			"repair-only",
			"repaired",
		]);
	});

	it("does not accept a symlinked uv launcher outside the environment", async () => {
		// Given a cloned uv seed with one non-interpreter launcher symlinked outside.
		const repoRoot = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-uv-launcher-repo-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-uv-launcher-worktree-"),
		);
		const external = join(
			await mkdtemp(join(tmpdir(), "gji-bootstrap-uv-launcher-out-")),
			"tool",
		);
		await writeFile(join(repoRoot, "uv.lock"), "versioned\n");
		await mkdir(join(repoRoot, ".venv", "bin"), { recursive: true });
		await writeFile(external, "external\n");
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			checkUvRuntime: async () => true,
			repoRoot,
			worktreePath,
		});

		// When relocation inspects the individual launcher before repair.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				await mkdir(join(destination, "bin"), { recursive: true });
				await writeFile(join(destination, "pyvenv.cfg"), "version = 3.13\n");
				await symlink(external, join(destination, "bin", "tool"));
				return { ms: 1 };
			},
			reporter: createReporter(),
			runCommand: async () => {
				await writeUvTestInterpreter(
					join(worktreePath, ".venv"),
					join(worktreePath, ".venv"),
				);
			},
		});

		// Then the unsafe seed is discarded without changing the external target.
		expect(result.ready).toBe(true);
		await expect(readFile(external, "utf8")).resolves.toBe("external\n");
		expect(result.events.map(({ state }) => state)).toEqual([
			"seeded",
			"repair-only",
			"repaired",
		]);
	});

	it("retries uv from a clean target when repaired scripts still use the source prefix", async () => {
		// Given a cloned environment whose first locked repair restores a source-bound interpreter.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-uv-stale-"));
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-uv-stale-worktree-"),
		);
		await writeFile(join(repoRoot, "uv.lock"), "versioned\n");
		await mkdir(join(repoRoot, ".venv", "bin"), { recursive: true });
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			checkUvRuntime: async () => true,
			repoRoot,
			worktreePath,
		});
		let repairAttempts = 0;

		// When post-repair validation detects the stale prefix.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				await mkdir(join(destination, "bin"), { recursive: true });
				return { ms: 1 };
			},
			reporter: createReporter(),
			runCommand: async () => {
				repairAttempts += 1;
				await writeUvTestInterpreter(
					join(worktreePath, ".venv"),
					repairAttempts === 1
						? join(repoRoot, ".venv")
						: join(worktreePath, ".venv"),
				);
			},
		});

		// Then the seed is removed and the clean repair is accepted only after relocation succeeds.
		expect(result.ready).toBe(true);
		expect(repairAttempts).toBe(2);
		expect(result.events.map(({ state }) => state)).toEqual([
			"seeded",
			"repair-only",
			"repaired",
		]);
	});

	it("reuses a uv environment when its own interpreter matches its metadata", async () => {
		// Given a uv environment whose Python version differs from the gji process.
		const repoRoot = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-uv-mismatch-repo-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-uv-mismatch-worktree-"),
		);
		await writeFile(join(repoRoot, "uv.lock"), "versioned\n");
		await mkdir(join(repoRoot, ".venv", "bin"), { recursive: true });
		await writeFile(
			join(repoRoot, ".venv", "pyvenv.cfg"),
			"version_info = 3.11.11\nimplementation = CPython\n",
		);
		const interpreter = join(repoRoot, ".venv", "bin", "python");
		await writeFile(interpreter, "#!/bin/sh\nprintf '3.11|arm64|cpython\\n'\n");
		await chmod(interpreter, 0o755);
		const originalPath = process.env.PATH;
		process.env.PATH = "";
		let plan: Awaited<ReturnType<typeof prepareDependencyBootstrap>>;
		try {
			plan = await prepareDependencyBootstrap("cow-then-repair", {
				repoRoot,
				worktreePath,
			});
		} finally {
			if (originalPath === undefined) delete process.env.PATH;
			else process.env.PATH = originalPath;
		}
		let cloneCalled = false;

		// When bootstrap evaluates the seed using only that environment's interpreter.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				cloneCalled = true;
				await mkdir(destination, { recursive: true });
				return { ms: 1 };
			},
			reporter: createReporter(),
			runCommand: async () =>
				writeUvTestInterpreter(
					join(worktreePath, ".venv"),
					join(worktreePath, ".venv"),
				),
		});

		// Then the self-consistent environment is seeded and repaired.
		expect(result.ready).toBe(true);
		expect(cloneCalled).toBe(true);
		expect(result.events.map(({ state }) => state)).toEqual([
			"seeded",
			"repaired",
		]);
	});

	it("rejects uv seeds whose interpreter disagrees with environment metadata", async () => {
		// Given uv environments with mismatched or unusable interpreter fingerprints.
		const cases = [
			{
				config: "version_info = 3.12.1\nimplementation = CPython\n",
				script: "printf '3.11|arm64|cpython\\n'",
			},
			{
				config: "version_info = 3.11.1\nimplementation = PyPy\n",
				script: "printf '3.11|arm64|cpython\\n'",
			},
			{
				config: "version_info = 3.11.1\nimplementation = CPython\n",
				script: "printf 'not-a-fingerprint\\n'",
			},
			{
				config: "version_info = 3.11.1\nimplementation = CPython\n",
				script: "exit 1",
			},
		];

		// When each environment is considered as a CoW seed.
		for (const [index, testCase] of cases.entries()) {
			const repoRoot = await mkdtemp(
				join(tmpdir(), `gji-uv-invalid-${index}-`),
			);
			const worktreePath = await mkdtemp(
				join(tmpdir(), `gji-uv-invalid-worktree-${index}-`),
			);
			await writeFile(join(repoRoot, "uv.lock"), "versioned\n");
			await mkdir(join(repoRoot, ".venv", "bin"), { recursive: true });
			await writeFile(join(repoRoot, ".venv", "pyvenv.cfg"), testCase.config);
			const interpreter = join(repoRoot, ".venv", "bin", "python");
			await writeFile(interpreter, `#!/bin/sh\n${testCase.script}\n`);
			await chmod(interpreter, 0o755);

			const plan = await prepareDependencyBootstrap("cow-then-repair", {
				repoRoot,
				worktreePath,
			});

			// Then the incompatible environment is repaired from an empty target.
			expect(plan.targets[0]?.seedable).toBe(false);
		}
	});

	it("clones Cargo build state before cargo check repair", async () => {
		// Given a Cargo lockfile and an existing target cache.
		const repoRoot = await mkdtemp(join(tmpdir(), "gji-bootstrap-cargo-repo-"));
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-cargo-worktree-"),
		);
		await writeFile(join(repoRoot, "Cargo.lock"), "version = 3\n");
		await mkdir(join(repoRoot, "target", "debug"), { recursive: true });
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			repoRoot,
			worktreePath,
		});
		const commands: string[] = [];

		// When the Cargo adapter bootstraps the worktree.
		const result = await executeDependencyBootstrap(plan, {
			cloneDirectory: async (_source, destination) => {
				await mkdir(destination, { recursive: true });
				return { ms: 1 };
			},
			reporter: createReporter(),
			runCommand: async (command) => {
				commands.push(command);
			},
		});

		// Then the build cache is reported as repaired rather than as a dependency install.
		expect(result.ready).toBe(true);
		expect(commands).toEqual(["cargo check"]);
		expect(result.events[0]?.kind).toBe("build-cache");
		expect(result.events.at(-1)?.state).toBe("repaired");
	});

	it("uses a configured Cargo repair command", async () => {
		// Given a Cargo lockfile and a repository-specific build repair command.
		const repoRoot = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-cargo-command-repo-"),
		);
		const worktreePath = await mkdtemp(
			join(tmpdir(), "gji-bootstrap-cargo-command-worktree-"),
		);
		await writeFile(join(repoRoot, "Cargo.lock"), "version = 3\n");

		// When the bootstrap plan is prepared with the configured command.
		const plan = await prepareDependencyBootstrap("cow-then-repair", {
			cargoBuildCommand: "cargo check --workspace",
			repoRoot,
			worktreePath,
		});
		const commandOptions: unknown[] = [];

		await executeDependencyBootstrap(plan, {
			reporter: createReporter(),
			runCommand: async (_command, _cwd, _stderr, _stdout, options) => {
				commandOptions.push(options);
			},
		});

		// Then Cargo keeps the configured shell command in both its plan and execution.
		expect(plan.targets[0]?.target.repairCommand).toBe(
			"cargo check --workspace",
		);
		expect(commandOptions).toEqual([{ shell: true }]);
	});
});

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
