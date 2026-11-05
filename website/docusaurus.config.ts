import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";
import docStructuredData from "./plugins/doc-structured-data";

const terminalTheme = {
	...prismThemes.dracula,
	plain: { ...prismThemes.dracula.plain, backgroundColor: "#0d0f12" },
};

const config: Config = {
	title: "gji",
	tagline: "Switch tasks. Keep your place.",
	favicon: "img/favicon.svg",
	future: {
		v4: true,
	},
	url: "https://gji.solaqua.dev",
	baseUrl: "/",
	organizationName: "sjquant",
	projectName: "gji",
	deploymentBranch: "gh-pages",
	trailingSlash: false,
	onBrokenLinks: "throw",
	i18n: {
		defaultLocale: "en",
		locales: ["en", "ko", "ja"],
		localeConfigs: {
			en: { label: "English", htmlLang: "en" },
			ko: { label: "한국어", htmlLang: "ko" },
			ja: { label: "日本語", htmlLang: "ja" },
		},
	},
	customFields: {
		githubUrl: "https://github.com/sjquant/gji",
		npmUrl: "https://www.npmjs.com/package/@solaqua/gji",
	},
	presets: [
		[
			"classic",
			{
				docs: {
					sidebarPath: "./sidebars.ts",
					remarkPlugins: [docStructuredData],
					editUrl: "https://github.com/sjquant/gji/tree/main/website/",
					showLastUpdateTime: true,
					editLocalizedFiles: true,
				},
				blog: false,
				theme: {
					customCss: "./src/css/custom.css",
				},
			} satisfies Preset.Options,
		],
	],
	plugins: ["./plugins/clipboard-fallback"],
	themeConfig: {
		image: "img/social-card.png",
		metadata: [
			{
				name: "keywords",
				content:
					"git worktree cli, git worktree navigation, multi repo worktree, pull request review cli, git stash alternative, ai coding workflow",
			},
			{
				name: "twitter:card",
				content: "summary_large_image",
			},
		],
		colorMode: {
			defaultMode: "light",
			respectPrefersColorScheme: false,
		},
		navbar: {
			title: "gji",
			logo: {
				alt: "gji logo",
				src: "img/logo.svg",
				srcDark: "img/logo-dark.svg",
			},
			items: [
				{ type: "localeDropdown", position: "right" },
				{ to: "/docs/intro", label: "Docs", position: "right" },
				{
					href: "https://github.com/sjquant/gji",
					label: "GitHub",
					position: "right",
				},
			],
		},
		footer: {
			style: "light",
			links: [
				{
					title: "Docs",
					items: [
						{
							label: "Overview",
							to: "/docs/intro",
						},
						{
							label: "Quick Start",
							to: "/docs/quick-start",
						},
					],
				},
				{
					title: "Project",
					items: [
						{
							label: "GitHub",
							href: "https://github.com/sjquant/gji",
						},
						{
							label: "npm",
							href: "https://www.npmjs.com/package/@solaqua/gji",
						},
						{
							label: "Issues",
							href: "https://github.com/sjquant/gji/issues",
						},
					],
				},
				{
					title: "Why gji",
					items: [
						{
							label: "Comparison",
							to: "/docs/comparison",
						},
						{
							label: "Hooks",
							to: "/docs/hooks",
						},
					],
				},
			],
			// Keep the computed build year out of the static translation catalog.
			copyright:
				process.env.DOCUSAURUS_CURRENT_LOCALE === "ko"
					? `저작권 © ${new Date().getFullYear()} sjquant. MIT 라이선스.`
					: process.env.DOCUSAURUS_CURRENT_LOCALE === "ja"
						? `著作権 © ${new Date().getFullYear()} sjquant. MIT ライセンス。`
						: `Copyright © ${new Date().getFullYear()} sjquant. MIT License.`,
		},
		prism: {
			theme: terminalTheme,
			darkTheme: terminalTheme,
		},
	} satisfies Preset.ThemeConfig,
};

export default config;
