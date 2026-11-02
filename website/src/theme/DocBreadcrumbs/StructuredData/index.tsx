import Head from "@docusaurus/Head";
import {
	useBreadcrumbsStructuredData,
	useDoc,
} from "@docusaurus/plugin-content-docs/client";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import type { Props } from "@theme/DocBreadcrumbs/StructuredData";

export default function DocBreadcrumbsStructuredData(props: Props) {
	const structuredData = useBreadcrumbsStructuredData(props);
	const { metadata } = useDoc();
	const { siteConfig } = useDocusaurusContext();
	const pageUrl = new URL(metadata.permalink, siteConfig.url).href;
	return (
		<Head>
			<script type="application/ld+json">
				{JSON.stringify({
					...structuredData,
					"@id": `${pageUrl}#breadcrumb`,
				}).replaceAll("<", "\\u003c")}
			</script>
		</Head>
	);
}
