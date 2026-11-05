import Head from "@docusaurus/Head";
import { translate } from "@docusaurus/Translate";
import { useTitleFormatter } from "@docusaurus/theme-common/internal";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";

export type DocStructuredData = {
	kind: "faq" | "howto";
	introduction: string;
	sections: { id: string; name: string; text: string }[];
};

type Props = {
	title: string;
	description: string;
	permalink: string;
	doc?: boolean;
	content?: DocStructuredData;
};

export default function Seo({
	title,
	description,
	permalink,
	doc,
	content,
}: Props) {
	const {
		siteConfig,
		i18n: { currentLocale, localeConfigs, defaultLocale },
	} = useDocusaurusContext();
	const { format } = useTitleFormatter();
	const contentLanguage = localeConfigs[currentLocale].htmlLang;
	const siteUrl = new URL(siteConfig.baseUrl, siteConfig.url).href;
	const pageUrl = new URL(permalink, siteUrl).href;
	const websiteId = `${siteUrl}#website`;
	const productUrl = new URL(
		localeConfigs[defaultLocale].baseUrl,
		siteConfig.url,
	).href;
	const softwareId = `${productUrl}#software`;
	const authorId = `${productUrl}#author`;
	const pageId = `${pageUrl}#webpage`;
	const articleId = `${pageUrl}#article`;
	const githubUrl = siteConfig.customFields?.githubUrl as string;
	const npmUrl = siteConfig.customFields?.npmUrl as string;
	const imageAlt = translate({
		id: "seo.imageAlt",
		message: "gji: Switch tasks. Keep your place. A Git worktree CLI.",
	});
	const faq = content?.kind === "faq";
	const howto = content?.kind === "howto";
	const sections = content?.sections.map((section, index) => ({
		"@type": faq ? "Question" : "HowToStep",
		"@id": `${pageUrl}#${section.id}`,
		name: section.name,
		inLanguage: contentLanguage,
		url: `${pageUrl}#${section.id}`,
		...(faq
			? {
					acceptedAnswer: {
						"@type": "Answer",
						inLanguage: contentLanguage,
						"@id": `${pageUrl}#${section.id}-answer`,
						text: section.text,
					},
				}
			: { position: index + 1, text: section.text }),
	}));
	const graph = [
		{
			"@type": "WebSite",
			"@id": websiteId,
			name: siteConfig.title,
			url: siteUrl,
			inLanguage: contentLanguage,
			publisher: { "@id": authorId },
			about: { "@id": softwareId },
		},
		{
			"@type": "Person",
			"@id": authorId,
			name: "sjquant",
			url: "https://github.com/sjquant",
		},
		{
			"@type": ["SoftwareApplication", "SoftwareSourceCode"],
			"@id": softwareId,
			name: "gji",
			applicationCategory: "DeveloperApplication",
			...(!doc ? { description } : {}),
			url: productUrl,
			codeRepository: githubUrl,
			downloadUrl: npmUrl,
			sameAs: [githubUrl, npmUrl],
			author: { "@id": authorId },
			license: `${githubUrl}/blob/main/LICENSE`,
		},
		{
			"@type": faq ? ["WebPage", "FAQPage"] : "WebPage",
			"@id": pageId,
			name: title,
			description,
			url: pageUrl,
			inLanguage: contentLanguage,
			isPartOf: { "@id": websiteId },
			about: { "@id": softwareId },
			mainEntity: faq
				? sections?.map((section) => ({ "@id": section["@id"] }))
				: { "@id": doc ? articleId : softwareId },
			...(doc ? { breadcrumb: { "@id": `${pageUrl}#breadcrumb` } } : {}),
		},
		...(doc && !faq
			? [
					{
						"@type": howto ? ["TechArticle", "HowTo"] : "TechArticle",
						"@id": articleId,
						headline: title,
						name: title,
						...(howto
							? {
									text: content.introduction,
									step: sections?.map((section) => ({ "@id": section["@id"] })),
								}
							: {}),
						description,
						url: pageUrl,
						inLanguage: contentLanguage,
						mainEntityOfPage: { "@id": pageId },
						isPartOf: { "@id": websiteId },
						about: { "@id": softwareId },
					},
				]
			: []),
		...(sections ?? []),
	];

	return (
		<Head>
			<meta
				name="keywords"
				content={translate({
					id: "seo.keywords",
					message:
						"git worktree cli, git worktree navigation, multi repo worktree, pull request review cli, git stash alternative, ai coding workflow",
				})}
			/>
			<meta name="twitter:title" content={format(title)} />
			<meta name="twitter:description" content={description} />
			<meta property="og:image:alt" content={imageAlt} />
			<meta name="twitter:image:alt" content={imageAlt} />
			<script type="application/ld+json">
				{JSON.stringify({
					"@context": "https://schema.org",
					"@graph": graph,
				}).replaceAll("<", "\\u003c")}
			</script>
		</Head>
	);
}
