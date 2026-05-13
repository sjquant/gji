#!/usr/bin/env node
import { execSync } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
/**
 * Generates man pages for gji and each subcommand from the live Commander.js
 * program. Run after `pnpm build` — requires dist/cli.js to exist.
 *
 * Output: man/man1/gji.1  +  man/man1/gji-<command>.1 for every subcommand.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const require = createRequire(import.meta.url);

const distCli = join(projectRoot, "dist", "cli.js");
try {
	await access(distCli);
} catch {
	console.error("Error: dist/cli.js not found. Run `pnpm build` first.");
	process.exit(1);
}

const { createProgram } = await import(`${projectRoot}/dist/cli.js`);
const pkg = require("../package.json");
const program = createProgram();

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/**
 * Return the month+year of the git tag for this version so the date is stable
 * for a given release. Falls back to the current date for untagged dev builds.
 */
function releaseDateStr(version) {
	try {
		const iso = execSync(`git log -1 --format=%cI "v${version}"`, {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (iso) {
			const d = new Date(iso);
			return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
		}
	} catch {
		/* tag not found — fall through */
	}
	const d = new Date();
	return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

const version = String(pkg.version ?? "0.0.0");
const dateStr = releaseDateStr(version);

/** Escape special roff characters. */
function esc(str) {
	return String(str ?? "")
		.replace(/\\/g, "\\\\")
		.replace(/-/g, "\\-");
}

/** Produce a .SH OPTIONS section for a command, or '' if it has no options. */
function optionsSection(cmd) {
	if (cmd.options.length === 0) return "";
	let out = ".SH OPTIONS\n";
	for (const opt of cmd.options) {
		out += `.TP\n.B ${esc(opt.flags)}\n${esc(opt.description ?? "")}\n`;
	}
	return out;
}

/** Generate gji.1 — the top-level man page. */
function mainManPage() {
	let out = `.TH GJI 1 "${dateStr}" "gji ${version}" "User Commands"\n`;
	out += `.SH NAME\ngji \\- ${esc(program.description())}\n`;
	out += `.SH SYNOPSIS\n.B gji\n[\\fIoptions\\fR] <\\fIcommand\\fR> [\\fIargs\\fR]\n`;
	out += `.SH DESCRIPTION\n${esc(program.description())}\n`;
	out += `.PP\nEach branch lives in its own worktree with its own node_modules and terminal,\n`;
	out += `eliminating the need for \\fBgit stash\\fR when switching contexts.\n`;

	if (program.commands.length > 0) {
		out += ".SH COMMANDS\n";
		for (const cmd of program.commands) {
			const usage = cmd.usage();
			const synopsis = usage
				? `${esc(cmd.name())} ${esc(usage)}`
				: esc(cmd.name());
			out += `.TP\n.B ${synopsis}\n${esc(cmd.description() ?? "")}\n`;
			const alias = cmd.alias();
			if (alias) out += `.br\nAlias: \\fB${esc(alias)}\\fR\n`;
		}
	}

	out += optionsSection(program);

	const seeAlso = program.commands
		.map((cmd) => `.BR gji\\-${esc(cmd.name())} (1)`)
		.join(",\n");
	if (seeAlso) out += `.SH "SEE ALSO"\n${seeAlso}\n`;

	return out;
}

/** Generate gji-<name>.1 for a single subcommand. */
function subcommandManPage(cmd) {
	const cmdName = `gji-${cmd.name()}`;
	const desc = cmd.description() ?? "";
	const usage = cmd.usage() ?? "";

	let out = `.TH ${cmdName.toUpperCase().replace(/-/g, "\\-")} 1 "${dateStr}" "gji ${version}" "User Commands"\n`;
	out += `.SH NAME\n${esc(cmdName)} \\- ${esc(desc)}\n`;

	const synopsisTokens = [".B gji", esc(cmd.name())];
	if (cmd.options.length > 0) synopsisTokens.push("[\\fIoptions\\fR]");
	if (usage) synopsisTokens.push(esc(usage));
	out += `.SH SYNOPSIS\n${synopsisTokens.join(" ")}\n`;

	out += `.SH DESCRIPTION\n${esc(desc)}\n`;

	out += optionsSection(cmd);

	if (cmd.commands.length > 0) {
		out += ".SH SUBCOMMANDS\n";
		for (const sub of cmd.commands) {
			out += `.TP\n.B ${esc(sub.name())}\n${esc(sub.description() ?? "")}\n`;
		}
	}

	out += `.SH "SEE ALSO"\n.BR gji (1)\n`;

	return out;
}

const manDir = join(projectRoot, "man", "man1");
await mkdir(manDir, { recursive: true });

await writeFile(join(manDir, "gji.1"), mainManPage(), "utf8");
console.log("Generated man/man1/gji.1");

for (const cmd of program.commands) {
	const filename = `gji-${cmd.name()}.1`;
	await writeFile(join(manDir, filename), subcommandManPage(cmd), "utf8");
	console.log(`Generated man/man1/${filename}`);
}
