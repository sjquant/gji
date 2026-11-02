import { basename } from "node:path";

/** Extract structured FAQ answers and tutorial steps from the existing docs. */
export default function docStructuredData() {
	return (tree, file) => {
		const filename = basename(file.path);
		if (filename !== "faq.mdx" && filename !== "quick-start.mdx") return;

		const sections = [];
		const introduction = [];
		let section;
		for (const node of tree.children) {
			if (node.type === "heading" && node.depth === 2) {
				section = { id: node.data.id, name: contentText(node), text: "" };
				sections.push(section);
			} else {
				const text = contentText(node);
				if (!text) continue;
				if (section) section.text += `${section.text ? "\n\n" : ""}${text}`;
				else introduction.push(text);
			}
		}

		file.data.frontMatter.structuredData = {
			kind: filename === "faq.mdx" ? "faq" : "howto",
			introduction: introduction.join("\n\n"),
			sections:
				filename === "faq.mdx"
					? sections
					: sections.filter(({ name }) => /^\d+\. /.test(name)),
		};
	};
}

/** Preserve prose, commands and link destinations as plain text. */
function contentText(node) {
	if (["yaml", "mdxjsEsm"].includes(node.type)) return "";
	if (typeof node.value === "string") return node.value;
	if (node.type === "break") return "\n";
	const text = (node.children ?? [])
		.map(contentText)
		.join(node.type === "list" || node.type === "listItem" ? "\n\n" : "");
	return node.type === "link" ? `${text} (${node.url})` : text;
}
