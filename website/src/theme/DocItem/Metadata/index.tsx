import { useDoc } from "@docusaurus/plugin-content-docs/client";
import Metadata from "@theme-original/DocItem/Metadata";
import Seo, { type DocStructuredData } from "../../../components/Seo";

export default function DocItemMetadata() {
	const { metadata, frontMatter } = useDoc();
	const { structuredData } = frontMatter as typeof frontMatter & {
		structuredData?: DocStructuredData;
	};
	return (
		<>
			<Metadata />
			<Seo
				title={metadata.title}
				description={metadata.description}
				permalink={metadata.permalink}
				content={structuredData}
				doc
			/>
		</>
	);
}
