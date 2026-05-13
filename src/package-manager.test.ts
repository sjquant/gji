import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { detectPackageManager } from "./package-manager.js";

async function makeDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "gji-pm-"));
}

async function touch(dir: string, filename: string): Promise<void> {
	await writeFile(join(dir, filename), "");
}

describe("detectPackageManager", () => {
	it("returns null for an empty directory", async () => {
		const dir = await makeDir();
		expect(await detectPackageManager(dir)).toBeNull();
	});

	it("returns null for a non-existent directory", async () => {
		expect(
			await detectPackageManager("/tmp/gji-nonexistent-dir-xyz"),
		).toBeNull();
	});

	// JavaScript / TypeScript
	it.each([
		["pnpm-lock.yaml", "pnpm", "pnpm install"],
		["yarn.lock", "yarn", "yarn install"],
		["bun.lockb", "bun", "bun install"],
		["package-lock.json", "npm", "npm install"],
		["deno.json", "deno", "deno cache"],
		["deno.jsonc", "deno", "deno cache"],
	])("detects %s", async (file, name, installCommand) => {
		const dir = await makeDir();
		await touch(dir, file);
		expect(await detectPackageManager(dir)).toEqual({ name, installCommand });
	});

	// Python
	it.each([
		["poetry.lock", "poetry", "poetry install"],
		["uv.lock", "uv", "uv sync"],
		["Pipfile.lock", "pipenv", "pipenv install"],
		["pdm.lock", "pdm", "pdm install"],
		["conda-lock.yml", "conda-lock", "conda-lock install"],
		["environment.yml", "conda", "conda env update --file environment.yml"],
	])("detects %s", async (file, name, installCommand) => {
		const dir = await makeDir();
		await touch(dir, file);
		expect(await detectPackageManager(dir)).toEqual({ name, installCommand });
	});

	// R
	it("detects renv.lock", async () => {
		const dir = await makeDir();
		await touch(dir, "renv.lock");
		expect(await detectPackageManager(dir)).toEqual({
			name: "renv",
			installCommand: "Rscript -e 'renv::restore()'",
		});
	});

	// Rust
	it("detects Cargo.lock", async () => {
		const dir = await makeDir();
		await touch(dir, "Cargo.lock");
		expect(await detectPackageManager(dir)).toEqual({
			name: "cargo",
			installCommand: "cargo build",
		});
	});

	// Go
	it("detects go.sum", async () => {
		const dir = await makeDir();
		await touch(dir, "go.sum");
		expect(await detectPackageManager(dir)).toEqual({
			name: "go",
			installCommand: "go mod download",
		});
	});

	// Ruby
	it("detects Gemfile.lock", async () => {
		const dir = await makeDir();
		await touch(dir, "Gemfile.lock");
		expect(await detectPackageManager(dir)).toEqual({
			name: "bundler",
			installCommand: "bundle install",
		});
	});

	// PHP
	it("detects composer.lock", async () => {
		const dir = await makeDir();
		await touch(dir, "composer.lock");
		expect(await detectPackageManager(dir)).toEqual({
			name: "composer",
			installCommand: "composer install",
		});
	});

	// Elixir / Erlang
	it.each([
		["mix.lock", "mix", "mix deps.get"],
		["rebar.lock", "rebar3", "rebar3 deps"],
	])("detects %s", async (file, name, installCommand) => {
		const dir = await makeDir();
		await touch(dir, file);
		expect(await detectPackageManager(dir)).toEqual({ name, installCommand });
	});

	// Dart / Flutter
	it("detects pubspec.lock", async () => {
		const dir = await makeDir();
		await touch(dir, "pubspec.lock");
		expect(await detectPackageManager(dir)).toEqual({
			name: "dart",
			installCommand: "dart pub get",
		});
	});

	// Java / Kotlin / Scala
	it("detects pom.xml", async () => {
		const dir = await makeDir();
		await touch(dir, "pom.xml");
		expect(await detectPackageManager(dir)).toEqual({
			name: "maven",
			installCommand: "mvn install",
		});
	});

	it("detects gradlew and uses wrapper command", async () => {
		const dir = await makeDir();
		await touch(dir, "gradlew");
		expect(await detectPackageManager(dir)).toEqual({
			name: "gradle",
			installCommand: "./gradlew build",
		});
	});

	it.each([
		["build.gradle"],
		["build.gradle.kts"],
	])("detects %s and falls back to gradle when no wrapper", async (file) => {
		const dir = await makeDir();
		await touch(dir, file);
		expect(await detectPackageManager(dir)).toEqual({
			name: "gradle",
			installCommand: "gradle build",
		});
	});

	it("prefers gradlew over build.gradle when both exist", async () => {
		const dir = await makeDir();
		await touch(dir, "gradlew");
		await touch(dir, "build.gradle");
		expect(await detectPackageManager(dir)).toEqual({
			name: "gradle",
			installCommand: "./gradlew build",
		});
	});

	it("detects build.sbt", async () => {
		const dir = await makeDir();
		await touch(dir, "build.sbt");
		expect(await detectPackageManager(dir)).toEqual({
			name: "sbt",
			installCommand: "sbt compile",
		});
	});

	// .NET
	it.each([
		["MyApp.sln"],
		["MyApp.csproj"],
		["MyApp.fsproj"],
		["MyApp.vbproj"],
	])("detects dotnet via %s", async (file) => {
		const dir = await makeDir();
		await touch(dir, file);
		expect(await detectPackageManager(dir)).toEqual({
			name: "dotnet",
			installCommand: "dotnet restore",
		});
	});

	// Swift
	it("detects Package.swift", async () => {
		const dir = await makeDir();
		await touch(dir, "Package.swift");
		expect(await detectPackageManager(dir)).toEqual({
			name: "swift",
			installCommand: "swift package resolve",
		});
	});

	// Haskell
	it("detects stack.yaml", async () => {
		const dir = await makeDir();
		await touch(dir, "stack.yaml");
		expect(await detectPackageManager(dir)).toEqual({
			name: "stack",
			installCommand: "stack build",
		});
	});

	it("detects cabal.project", async () => {
		const dir = await makeDir();
		await touch(dir, "cabal.project");
		expect(await detectPackageManager(dir)).toEqual({
			name: "cabal",
			installCommand: "cabal install --only-dependencies",
		});
	});

	it("detects *.cabal via glob", async () => {
		const dir = await makeDir();
		await touch(dir, "myapp.cabal");
		expect(await detectPackageManager(dir)).toEqual({
			name: "cabal",
			installCommand: "cabal install --only-dependencies",
		});
	});

	it("prefers cabal.project over *.cabal glob", async () => {
		const dir = await makeDir();
		await touch(dir, "cabal.project");
		await touch(dir, "myapp.cabal");
		// cabal.project (exact) is listed before *.cabal (glob) in ENTRIES
		expect(await detectPackageManager(dir)).toEqual({
			name: "cabal",
			installCommand: "cabal install --only-dependencies",
		});
	});

	// Clojure
	it.each([
		["deps.edn", "clojure", "clojure -P"],
		["project.clj", "leiningen", "lein deps"],
	])("detects %s", async (file, name, installCommand) => {
		const dir = await makeDir();
		await touch(dir, file);
		expect(await detectPackageManager(dir)).toEqual({ name, installCommand });
	});

	// OCaml
	it("detects dune-project", async () => {
		const dir = await makeDir();
		await touch(dir, "dune-project");
		expect(await detectPackageManager(dir)).toEqual({
			name: "dune",
			installCommand: "dune build",
		});
	});

	// Julia
	it("detects Manifest.toml", async () => {
		const dir = await makeDir();
		await touch(dir, "Manifest.toml");
		expect(await detectPackageManager(dir)).toEqual({
			name: "julia",
			installCommand: "julia --project -e 'using Pkg; Pkg.instantiate()'",
		});
	});

	// Nim
	it("detects *.nimble via glob", async () => {
		const dir = await makeDir();
		await touch(dir, "mypkg.nimble");
		expect(await detectPackageManager(dir)).toEqual({
			name: "nimble",
			installCommand: "nimble install",
		});
	});

	// Crystal
	it("detects shard.yml", async () => {
		const dir = await makeDir();
		await touch(dir, "shard.yml");
		expect(await detectPackageManager(dir)).toEqual({
			name: "shards",
			installCommand: "shards install",
		});
	});

	// Perl
	it("detects cpanfile", async () => {
		const dir = await makeDir();
		await touch(dir, "cpanfile");
		expect(await detectPackageManager(dir)).toEqual({
			name: "cpanm",
			installCommand: "cpanm --installdeps .",
		});
	});

	// Zig
	it("detects build.zig.zon", async () => {
		const dir = await makeDir();
		await touch(dir, "build.zig.zon");
		expect(await detectPackageManager(dir)).toEqual({
			name: "zig",
			installCommand: "zig build",
		});
	});

	// C / C++
	it.each([
		["vcpkg.json", "vcpkg", "vcpkg install"],
		["conanfile.py", "conan", "conan install ."],
		["conanfile.txt", "conan", "conan install ."],
	])("detects %s", async (file, name, installCommand) => {
		const dir = await makeDir();
		await touch(dir, file);
		expect(await detectPackageManager(dir)).toEqual({ name, installCommand });
	});

	// Nix
	it.each([
		["flake.nix", "nix", "nix develop"],
		["shell.nix", "nix-shell", "nix-shell"],
	])("detects %s", async (file, name, installCommand) => {
		const dir = await makeDir();
		await touch(dir, file);
		expect(await detectPackageManager(dir)).toEqual({ name, installCommand });
	});

	it("prefers flake.nix over shell.nix", async () => {
		const dir = await makeDir();
		await touch(dir, "flake.nix");
		await touch(dir, "shell.nix");
		expect(await detectPackageManager(dir)).toEqual({
			name: "nix",
			installCommand: "nix develop",
		});
	});

	// Terraform
	it("detects terraform.lock.hcl", async () => {
		const dir = await makeDir();
		await touch(dir, "terraform.lock.hcl");
		expect(await detectPackageManager(dir)).toEqual({
			name: "terraform",
			installCommand: "terraform init",
		});
	});

	// Priority
	it("prefers pnpm over yarn when both lockfiles are present", async () => {
		const dir = await makeDir();
		await touch(dir, "pnpm-lock.yaml");
		await touch(dir, "yarn.lock");
		expect(await detectPackageManager(dir)).toEqual({
			name: "pnpm",
			installCommand: "pnpm install",
		});
	});

	it("ignores unrelated files", async () => {
		const dir = await makeDir();
		await touch(dir, "README.md");
		await mkdir(join(dir, "src"), { recursive: true });
		expect(await detectPackageManager(dir)).toBeNull();
	});
});
