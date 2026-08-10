export function sanitizeTerminalText(value: string): string {
	return Array.from(value, (character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
			? " "
			: character;
	}).join("");
}

export function middleEllipsize(value: string, maxLength: number): string {
	if (terminalWidth(value) <= maxLength) return value;
	if (maxLength <= 1) return "…";

	const keep = maxLength - 1;
	const start = takeTerminalColumns(value, Math.ceil(keep / 2), "start");
	const end = takeTerminalColumns(value, Math.floor(keep / 2), "end");
	return `${start}…${end}`;
}

export function startEllipsize(value: string, maxLength: number): string {
	if (terminalWidth(value) <= maxLength) return value;
	if (maxLength <= 1) return "…";
	return `…${takeTerminalColumns(value, maxLength - 1, "end")}`;
}

export function terminalWidth(value: string): number {
	let width = 0;
	for (const character of Array.from(value)) {
		width += characterTerminalWidth(character);
	}
	return width;
}

function takeTerminalColumns(
	value: string,
	maxWidth: number,
	direction: "start" | "end",
): string {
	const characters =
		direction === "start" ? Array.from(value) : Array.from(value).reverse();
	const kept: string[] = [];
	let width = 0;

	for (const character of characters) {
		const characterWidth = characterTerminalWidth(character);
		if (width + characterWidth > maxWidth) break;
		kept.push(character);
		width += characterWidth;
	}

	return direction === "start" ? kept.join("") : kept.reverse().join("");
}

function characterTerminalWidth(character: string): number {
	const codePoint = character.codePointAt(0);
	if (codePoint === undefined) return 0;
	if (isZeroWidthCodePoint(codePoint) || /\p{Mark}/u.test(character)) return 0;
	return isWideCodePoint(codePoint) ? 2 : 1;
}

function isZeroWidthCodePoint(codePoint: number): boolean {
	return (
		codePoint === 0 ||
		codePoint === 0x200d ||
		(codePoint >= 0xfe00 && codePoint <= 0xfe0f)
	);
}

function isWideCodePoint(codePoint: number): boolean {
	return (
		(codePoint >= 0x1100 && codePoint <= 0x115f) ||
		codePoint === 0x2329 ||
		codePoint === 0x232a ||
		(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
		(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
		(codePoint >= 0xff00 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
		(codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
		(codePoint >= 0x20000 && codePoint <= 0x3fffd)
	);
}
