import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = fileURLToPath(new URL("..", import.meta.url));
const assets = join(root, ".github/assets");
const images = join(root, "website/static/img");
const scenes = JSON.parse(
	readFileSync(
		join(root, "website/src/components/workflow-scenes.json"),
		"utf8",
	),
);
const branches = ["feature/payments", "feature/search", "PR #1234"];

main();

function main() {
	const temporary = mkdtempSync(join(tmpdir(), "gji-preview-"));
	try {
		mkdirSync(assets, { recursive: true });

		const frames = scenes.flatMap((scene, index) => {
			const typingFrames = Math.ceil(scene.command.length / 4);
			const framesForScene = [];
			for (let frame = 0; frame <= typingFrames; frame++) {
				const command = scene.command.slice(0, frame * 4);
				const svg = join(temporary, `frame-${index}-${frame}.svg`);
				writeFileSync(svg, renderScene(scene, command));
				framesForScene.push({
					path: rasterize(svg, temporary),
					duration: frame === typingFrames ? 2.8 - typingFrames * 0.09 : 0.09,
				});
			}
			return framesForScene;
		});
		const manifest = join(temporary, "frames.txt");
		writeFileSync(
			manifest,
			`${frames.map((frame) => `file '${frame.path}'\nduration ${frame.duration}`).join("\n")}\nfile '${frames.at(-1).path}'\n`,
		);
		execFileSync("ffmpeg", [
			"-v",
			"error",
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			manifest,
			"-vf",
			"fps=12,split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=sierra2_4a",
			"-t",
			String(scenes.length * 2.8),
			"-loop",
			"0",
			join(assets, "readme-workflow.gif"),
		]);
		copyFileSync(frames.at(-1).path, join(assets, "readme-workflow.png"));
		copyFileSync(
			rasterize(join(images, "social-card.svg"), temporary),
			join(images, "social-card.png"),
		);
		const icon = rasterize(join(images, "favicon.svg"), temporary);
		execFileSync("ffmpeg", [
			"-v",
			"error",
			"-y",
			"-i",
			icon,
			"-vf",
			"scale=64:64",
			"-c:v",
			"bmp",
			join(images, "favicon.ico"),
		]);
		console.log(
			"Updated README workflow GIF/still, social card PNG, and favicon ICO.",
		);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

function renderScene(scene, command) {
	const transcript = [
		`$ ${command}`,
		...(command === scene.command ? scene.lines : []),
	];
	const lines = transcript
		.map(
			(line, row) =>
				`<text x="40" y="${70 + row * 38}">${highlightCommand(line)}</text>`,
		)
		.join("");
	const workspaces = branches
		.slice(0, scene.visible)
		.map((branch, index) => {
			const x = 40 + index * 380;
			return `<path d="M${x} 325v38" stroke="${index === scene.active ? "#bdd49e" : "#30363d"}" stroke-width="3"/><text x="${x + 15}" y="351" fill="#9da7b3" font-size="18">${escapeXml(branch)}</text>`;
		})
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420"><rect width="1200" height="420" rx="10" fill="#0d0f12"/><g font-family="Menlo,Consolas,monospace" font-size="25" xml:space="preserve">${lines}</g><g font-family="Menlo,Consolas,monospace">${workspaces}</g></svg>`;
}

function highlightCommand(value) {
	return value
		.split(/(\s+)/)
		.map((token) => {
			const color =
				token === "$"
					? "#8b949e"
					: token === "git" || token === "gji"
						? "#79c0ff"
						: token.startsWith("-") || /^\d+$/.test(token)
							? "#d2a8ff"
							: token.includes("/")
								? "#f2cc8f"
								: "#e6edf3";
			return `<tspan fill="${color}">${escapeXml(token)}</tspan>`;
		})
		.join("");
}

function rasterize(svg, temporary) {
	const output = join(temporary, `${basename(svg)}.png`);
	const image = new Resvg(readFileSync(svg)).render();
	writeFileSync(output, image.asPng());
	return output;
}

function escapeXml(value) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
