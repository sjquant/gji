import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
	docsSidebar: [
		{
			type: "category",
			label: "Get Started",
			items: ["intro", "installation", "quick-start", "shell-integration"],
		},
		{
			type: "category",
			label: "Workflows",
			items: ["daily-workflow", "sync-and-cleanup"],
		},
		{
			type: "category",
			label: "Reference",
			items: [
				"commands",
				"configuration",
				"hooks",
				"troubleshooting",
				"faq",
				"comparison",
			],
		},
	],
};

export default sidebars;
