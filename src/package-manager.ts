import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface PackageManager {
	name: string;
	installCommand: string;
}

interface Entry {
	name: string;
	signals: string[];
	command: string;
	glob?: boolean;
}

const ENTRIES: Entry[] = [
	// JavaScript / TypeScript
	{ name: "pnpm", signals: ["pnpm-lock.yaml"], command: "pnpm install" },
	{ name: "yarn", signals: ["yarn.lock"], command: "yarn install" },
	{ name: "bun", signals: ["bun.lockb"], command: "bun install" },
	{ name: "npm", signals: ["package-lock.json"], command: "npm install" },
	{ name: "deno", signals: ["deno.json", "deno.jsonc"], command: "deno cache" },
	// Python
	{ name: "poetry", signals: ["poetry.lock"], command: "poetry install" },
	{ name: "uv", signals: ["uv.lock"], command: "uv sync" },
	{ name: "pipenv", signals: ["Pipfile.lock"], command: "pipenv install" },
	{ name: "pdm", signals: ["pdm.lock"], command: "pdm install" },
	{
		name: "conda-lock",
		signals: ["conda-lock.yml"],
		command: "conda-lock install",
	},
	{
		name: "conda",
		signals: ["environment.yml"],
		command: "conda env update --file environment.yml",
	},
	// R
	{
		name: "renv",
		signals: ["renv.lock"],
		command: "Rscript -e 'renv::restore()'",
	},
	// Rust
	{ name: "cargo", signals: ["Cargo.lock"], command: "cargo build" },
	// Go
	{ name: "go", signals: ["go.sum"], command: "go mod download" },
	// Ruby
	{ name: "bundler", signals: ["Gemfile.lock"], command: "bundle install" },
	// PHP
	{ name: "composer", signals: ["composer.lock"], command: "composer install" },
	// Elixir / Erlang
	{ name: "mix", signals: ["mix.lock"], command: "mix deps.get" },
	{ name: "rebar3", signals: ["rebar.lock"], command: "rebar3 deps" },
	// Dart / Flutter
	{ name: "dart", signals: ["pubspec.lock"], command: "dart pub get" },
	// Java / Kotlin / Scala
	{ name: "maven", signals: ["pom.xml"], command: "mvn install" },
	{ name: "gradle", signals: ["gradlew"], command: "./gradlew build" },
	{
		name: "gradle",
		signals: ["build.gradle", "build.gradle.kts"],
		command: "gradle build",
	},
	{ name: "sbt", signals: ["build.sbt"], command: "sbt compile" },
	// .NET (C# / F# / VB)
	{
		name: "dotnet",
		signals: ["*.sln", "*.csproj", "*.fsproj", "*.vbproj"],
		command: "dotnet restore",
		glob: true,
	},
	// Swift
	{
		name: "swift",
		signals: ["Package.swift"],
		command: "swift package resolve",
	},
	// Haskell
	{ name: "stack", signals: ["stack.yaml"], command: "stack build" },
	{
		name: "cabal",
		signals: ["cabal.project"],
		command: "cabal install --only-dependencies",
	},
	{
		name: "cabal",
		signals: ["*.cabal"],
		command: "cabal install --only-dependencies",
		glob: true,
	},
	// Clojure
	{ name: "clojure", signals: ["deps.edn"], command: "clojure -P" },
	{ name: "leiningen", signals: ["project.clj"], command: "lein deps" },
	// OCaml
	{ name: "dune", signals: ["dune-project"], command: "dune build" },
	// Julia
	{
		name: "julia",
		signals: ["Manifest.toml"],
		command: "julia --project -e 'using Pkg; Pkg.instantiate()'",
	},
	// Nim
	{
		name: "nimble",
		signals: ["*.nimble"],
		command: "nimble install",
		glob: true,
	},
	// Crystal
	{ name: "shards", signals: ["shard.yml"], command: "shards install" },
	// Perl
	{ name: "cpanm", signals: ["cpanfile"], command: "cpanm --installdeps ." },
	// Zig
	{ name: "zig", signals: ["build.zig.zon"], command: "zig build" },
	// C / C++
	{ name: "vcpkg", signals: ["vcpkg.json"], command: "vcpkg install" },
	{
		name: "conan",
		signals: ["conanfile.py", "conanfile.txt"],
		command: "conan install .",
	},
	// Nix
	{ name: "nix", signals: ["flake.nix"], command: "nix develop" },
	{ name: "nix-shell", signals: ["shell.nix"], command: "nix-shell" },
	// Terraform / OpenTofu
	{
		name: "terraform",
		signals: ["terraform.lock.hcl"],
		command: "terraform init",
	},
];

export async function detectPackageManager(
	repoRoot: string,
): Promise<PackageManager | null> {
	for (const entry of ENTRIES) {
		const matched = entry.glob
			? await matchesGlob(repoRoot, entry.signals)
			: await matchesExact(repoRoot, entry.signals);

		if (matched) {
			return { name: entry.name, installCommand: entry.command };
		}
	}

	return null;
}

async function matchesExact(
	repoRoot: string,
	signals: string[],
): Promise<boolean> {
	for (const signal of signals) {
		try {
			await access(join(repoRoot, signal));
			return true;
		} catch {
			// file not found, try next signal
		}
	}

	return false;
}

async function matchesGlob(
	repoRoot: string,
	patterns: string[],
): Promise<boolean> {
	let files: string[];

	try {
		files = await readdir(repoRoot);
	} catch {
		return false;
	}

	const regexes = patterns.map(patternToRegex);

	return files.some((file) => regexes.some((re) => re.test(file)));
}

function patternToRegex(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, "[^/]*");

	return new RegExp(`^${escaped}$`);
}
