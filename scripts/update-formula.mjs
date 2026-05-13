#!/usr/bin/env node
/**
 * Updates Formula/gji.rb with the URL and SHA256 for a given release.
 * Usage: node scripts/update-formula.mjs <version>
 * Example: node scripts/update-formula.mjs 0.4.0
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const version = process.argv[2]?.replace(/^v/, "");
if (!version) {
	console.error("Usage: node scripts/update-formula.mjs <version>");
	process.exit(1);
}

const tag = `v${version}`;
const tarball = `gji-v${version}.tar.gz`;
const url = `https://github.com/sjquant/gji/releases/download/${tag}/${tarball}`;

console.log(`Fetching ${url}...`);
const res = await fetch(url);
if (!res.ok) {
	console.error(`HTTP ${res.status}: ${res.statusText}`);
	process.exit(1);
}

const sha256 = createHash("sha256")
	.update(Buffer.from(await res.arrayBuffer()))
	.digest("hex");

const formulaPath = join(root, "Formula/gji.rb");
let formula = await readFile(formulaPath, "utf8");
formula = formula.replace(/url ".*"/, `url "${url}"`);
formula = formula.replace(/sha256 ".*"/, `sha256 "${sha256}"`);
await writeFile(formulaPath, formula, "utf8");

console.log(`Updated Formula/gji.rb`);
console.log(`  url    ${url}`);
console.log(`  sha256 ${sha256}`);
