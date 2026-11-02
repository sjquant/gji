import Head from "@docusaurus/Head";
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
	const { siteConfig } = useDocusaurusContext();
	const { format } = useTitleFormatter();
	const siteUrl = new URL(siteConfig.baseUrl, siteConfig.url).href;
	const pageUrl = new URL(permalink, siteUrl).href;
	const websiteId = `${siteUrl}#website`;
	const softwareId = `${siteUrl}#software`;
	const authorId = `${siteUrl}#author`;
	const pageId = `${pageUrl}#webpage`;
	const articleId = `${pageUrl}#article`;
	const githubUrl = siteConfig.customFields?.githubUrl as string;
	const npmUrl = siteConfig.customFields?.npmUrl as string;
	const faq = content?.kind === "faq";
	const howto = content?.kind === "howto";
	const sections = content?.sections.map((section, index) => ({
		"@type": faq ? "Question" : "HowToStep",
		"@id": `${pageUrl}#${section.id}`,
		name: section.name,
		url: `${pageUrl}#${section.id}`,
		...(faq
			? {
					acceptedAnswer: {
						"@type": "Answer",
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
			inLanguage: siteConfig.i18n.defaultLocale,
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
			url: siteUrl,
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
			inLanguage: siteConfig.i18n.defaultLocale,
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
						inLanguage: siteConfig.i18n.defaultLocale,
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
			<meta name="twitter:title" content={format(title)} />
			<script type="application/ld+json">
				{JSON.stringify({
					"@context": "https://schema.org",
					"@graph": graph,
				}).replaceAll("<", "\\u003c")}
			</script>
		</Head>
	);
}
