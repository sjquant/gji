import { execFile } from "node:child_process";
import { constants, type Dirent } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type {
	BootstrapExecutionContext,
	BootstrapTarget,
} from "./dependency-bootstrap.js";
import { isNotFoundError } from "./fs-utils.js";

const execFileAsync = promisify(execFile);
const UV_VALIDATION_MAX_ENTRIES = 10_000;
const UV_VALIDATION_MAX_FILE_BYTES = 1024 * 1024;
const UV_VALIDATION_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

function virtualEnvironmentPrefixes(text: string): string[] {
	const prefixes: string[] = [];
	for (const line of text.split(/\r?\n/u)) {
		if (!/\bVIRTUAL_ENV\b/u.test(line)) continue;
		const quotedAssignment = line.match(
			/\bVIRTUAL_ENV(?:\s*=|\s+)\s*(?:"([^"]+)"|'([^']+)')/u,
		);
		const quotedPrefix = quotedAssignment?.[1] ?? quotedAssignment?.[2];
		if (quotedPrefix && isAbsolute(quotedPrefix)) prefixes.push(quotedPrefix);
		const unquoted = line.match(/\bVIRTUAL_ENV(?:\s*=|\s+)\s*([^\s"']+)/u)?.[1];
		if (unquoted && isAbsolute(unquoted)) prefixes.push(unquoted);
	}
	return uniquePaths(prefixes);
}

function pythonPrefixFromShebang(text: string): string | undefined {
	const command = text
		.match(/^#!\s*([^\r\n]+)/u)?.[1]
		?.trim()
		.split(/\s+/u)[0];
	if (!command || !isAbsolute(command)) return undefined;
	if (
		!/^python(?:\d+(?:\.\d+)?)?(?:\.exe)?$/iu.test(
			command.split(sep).at(-1) ?? "",
		)
	) {
		return undefined;
	}
	return dirname(dirname(command));
}

function pythonPrefixesFromText(text: string): string[] {
	const interpreters: string[] = [];
	for (const match of text.matchAll(/["'](\/[^"']+)["']/gu)) {
		if (match[1]) interpreters.push(match[1]);
	}
	for (const match of text.matchAll(/(?:^|\s)(\/[^\s"']+)/gmu)) {
		if (match[1]) interpreters.push(match[1]);
	}
	return uniquePaths(
		interpreters.flatMap((interpreter) => {
			const name = interpreter.split(sep).at(-1) ?? "";
			return /^python(?:\d+(?:\.\d+)?)?(?:\.exe)?$/iu.test(name)
				? [dirname(dirname(interpreter))]
				: [];
		}),
	);
}

export async function validateUvRelocation(
	target: BootstrapTarget,
	context: BootstrapExecutionContext,
): Promise<void> {
	if (context.input === "preserve") return;
	if (!target.targetPath || !target.sourcePath) {
		throw new Error("uv environment target is not project-local");
	}

	const scriptsDirectory = join(
		target.targetPath,
		process.platform === "win32" ? "Scripts" : "bin",
	);
	const interpreter = join(
		scriptsDirectory,
		process.platform === "win32" ? "python.exe" : "python",
	);
	const { stdout } = await execFileAsync(interpreter, [
		"-c",
		"import os, sys; print(os.path.realpath(sys.prefix))",
	]);
	const [actualPrefix, expectedPrefix] = await Promise.all([
		realpath(stdout.trim()),
		realpath(target.targetPath),
	]);
	if (actualPrefix !== expectedPrefix) {
		throw new Error(
			`uv environment still points to its source prefix: ${actualPrefix}`,
		);
	}

	const sourcePaths = uniquePaths([
		target.sourcePath,
		(await realpath(target.sourcePath).catch(() => undefined)) ?? "",
	]).filter(Boolean);
	const entries = await readdir(scriptsDirectory, { withFileTypes: true });
	assertSafeUvScriptEntries(entries);
	const environmentName = basename(target.targetPath);
	const acceptedPrefixes = new Set([
		resolve(target.targetPath),
		await realpath(target.targetPath),
	]);
	let validatedBytes = 0;
	for (const path of [
		join(target.targetPath, "pyvenv.cfg"),
		...entries
			.filter((entry) => entry.isFile())
			.map((entry) => join(scriptsDirectory, entry.name)),
	]) {
		const validated = await readBoundedUvTextFile(
			path,
			UV_VALIDATION_MAX_TOTAL_BYTES - validatedBytes,
		);
		if (!validated) continue;
		validatedBytes += validated.bytes;
		if (validated.text === undefined) continue;
		const { text } = validated;
		if (sourcePaths.some((sourcePath) => text.includes(sourcePath))) {
			throw new Error(`uv environment contains a stale source path: ${path}`);
		}
		const shebangPrefix = pythonPrefixFromShebang(text);
		if (
			shebangPrefix &&
			basename(shebangPrefix) === environmentName &&
			!acceptedPrefixes.has(resolve(shebangPrefix))
		) {
			throw new Error(`uv launcher points outside its environment: ${path}`);
		}
		if (
			pythonPrefixesFromText(text)
				.filter((prefix) => basename(prefix) === environmentName)
				.some((prefix) => !acceptedPrefixes.has(resolve(prefix)))
		) {
			throw new Error(`uv launcher points outside its environment: ${path}`);
		}
		if (
			virtualEnvironmentPrefixes(text).some(
				(prefix) => !acceptedPrefixes.has(resolve(prefix)),
			)
		) {
			throw new Error(
				`uv activation script points outside its environment: ${path}`,
			);
		}
	}
}

export async function validateUvInstallation(
	target: BootstrapTarget,
	context: BootstrapExecutionContext,
): Promise<void> {
	await validateUvStructure(target, context);
	await validateUvRelocation(target, context);
}

export async function validateUvStructure(
	target: BootstrapTarget,
	context: BootstrapExecutionContext,
): Promise<void> {
	if (context.input === "preserve") return;
	if (!target.targetPath)
		throw new Error("uv environment target is not project-local");
	const targetStats = await lstat(target.targetPath).catch(() => undefined);
	if (!targetStats) return;
	if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
		throw new Error("uv environment must be a real directory");
	}

	const configStats = await lstat(join(target.targetPath, "pyvenv.cfg")).catch(
		() => undefined,
	);
	if (configStats && (!configStats.isFile() || configStats.isSymbolicLink())) {
		throw new Error("uv pyvenv.cfg must be a regular file");
	}

	const scriptsDirectory = join(
		target.targetPath,
		process.platform === "win32" ? "Scripts" : "bin",
	);
	const scriptsStats = await lstat(scriptsDirectory).catch(() => undefined);
	if (!scriptsStats) return;
	if (!scriptsStats.isDirectory() || scriptsStats.isSymbolicLink()) {
		throw new Error("uv scripts path must be a real directory");
	}
	assertSafeUvScriptEntries(
		await readdir(scriptsDirectory, { withFileTypes: true }),
	);
}

function assertSafeUvScriptEntries(entries: readonly Dirent[]): void {
	if (entries.length > UV_VALIDATION_MAX_ENTRIES) {
		throw new Error("uv scripts directory exceeds the validation entry limit");
	}
	for (const entry of entries) {
		if (entry.isSymbolicLink() && !isUvInterpreterName(entry.name)) {
			throw new Error(`uv script must not be a symbolic link: ${entry.name}`);
		}
	}
}

async function readBoundedUvTextFile(
	path: string,
	remainingBytes: number,
): Promise<{ bytes: number; text?: string } | undefined> {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(
			path,
			constants.O_RDONLY |
				(process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
		);
	} catch (error) {
		if (isNotFoundError(error)) return undefined;
		throw error;
	}
	try {
		const stats = await handle.stat();
		if (!stats.isFile()) return undefined;
		if (stats.size > UV_VALIDATION_MAX_FILE_BYTES) {
			throw new Error(`uv launcher exceeds the validation size limit: ${path}`);
		}
		if (stats.size > remainingBytes) {
			throw new Error("uv launchers exceed the total validation size limit");
		}
		const readLimit = Math.min(UV_VALIDATION_MAX_FILE_BYTES, remainingBytes);
		const contents = await readFilePrefix(handle, readLimit + 1);
		if (contents.byteLength > UV_VALIDATION_MAX_FILE_BYTES) {
			throw new Error(`uv launcher exceeds the validation size limit: ${path}`);
		}
		if (contents.byteLength > remainingBytes) {
			throw new Error("uv launchers exceed the total validation size limit");
		}
		const text = contents.toString("utf8");
		return Buffer.from(text, "utf8").equals(contents)
			? { bytes: contents.byteLength, text }
			: { bytes: contents.byteLength };
	} finally {
		await handle.close();
	}
}

async function readFilePrefix(
	handle: Awaited<ReturnType<typeof open>>,
	maxBytes: number,
): Promise<Buffer> {
	const contents = Buffer.allocUnsafe(maxBytes);
	let offset = 0;
	while (offset < contents.byteLength) {
		const { bytesRead } = await handle.read(
			contents,
			offset,
			contents.byteLength - offset,
			offset,
		);
		if (bytesRead === 0) break;
		offset += bytesRead;
	}
	return contents.subarray(0, offset);
}

function isUvInterpreterName(name: string): boolean {
	return /^python(?:\d+(?:\.\d+)?)?(?:\.exe)?$/iu.test(name);
}

function uniquePaths(paths: readonly (string | undefined)[]): string[] {
	return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}
