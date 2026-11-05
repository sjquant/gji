import Head from "@docusaurus/Head";
import { useLocation } from "@docusaurus/router";
import { PageMetadata } from "@docusaurus/theme-common";
import { useTitleFormatter } from "@docusaurus/theme-common/internal";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import useIsBrowser from "@docusaurus/useIsBrowser";
import OriginalNotFound from "@theme-original/NotFound";
import japanese from "../../../i18n/ja/code.json";
import korean from "../../../i18n/ko/code.json";
import chinese from "../../../i18n/zh-Hans/code.json";

/** Keep explicit translated missing paths localized on hosts with one root 404. */
export default function NotFound() {
	const { pathname, search, hash } = useLocation();
	const { i18n, siteConfig } = useDocusaurusContext();
	const isBrowser = useIsBrowser();
	const { format } = useTitleFormatter();

	const pathLocale = pathname.startsWith("/ko/")
		? "ko"
		: pathname.startsWith("/ja/")
			? "ja"
			: pathname.startsWith("/zh/")
				? "zh-Hans"
				: undefined;
	const locale = ["ko", "ja", "zh-Hans"].includes(i18n.currentLocale)
		? i18n.currentLocale
		: isBrowser
			? pathLocale
			: undefined;
	if (!locale) {
		return <OriginalNotFound />;
	}
	const useLocalizedFallback = i18n.currentLocale !== locale;
	const messages =
		locale === "ko" ? korean : locale === "ja" ? japanese : chinese;
	const baseUrl = i18n.localeConfigs[locale].baseUrl;
	const ogLocales = siteConfig.customFields?.ogLocales as Record<
		string,
		string
	>;
	const englishPath = pathname.slice(3);
	const unsafePath =
		englishPath.startsWith("//") ||
		/[\\\s]|\p{Cc}|%(?:5c|0[0-9a-f]|1[0-9a-f]|20|7f)/iu.test(englishPath);
	const counterpartPath = unsafePath ? "/" : englishPath;
	const englishUrl = unsafePath ? "/" : `${counterpartPath}${search}${hash}`;

	const title = messages["theme.NotFound.title"].message;
	const description = messages["theme.NotFound.p1"].message;
	const imageUrl = `${siteConfig.url}${baseUrl}img/social-card.png`;
	return (
		<>
			{!useLocalizedFallback && <OriginalNotFound />}
			<PageMetadata title={title} description={description} />
			<Head
				onChangeClientState={
					useLocalizedFallback
						? () => {
								// Helmet merges alternate links by href, so update the root bundle's links.
								for (const link of document.querySelectorAll<HTMLLinkElement>(
									'link[rel="alternate"][hreflang]',
								)) {
									const localeConfig =
										link.hreflang === "x-default"
											? i18n.localeConfigs[i18n.defaultLocale]
											: Object.values(i18n.localeConfigs).find(
													(config) => config.htmlLang === link.hreflang,
												);
									if (localeConfig) {
										link.href = `${siteConfig.url}${localeConfig.baseUrl}${counterpartPath.slice(1)}`;
									}
								}
							}
						: undefined
				}
			>
				<html lang={i18n.localeConfigs[locale].htmlLang} />
				<meta name="robots" content="noindex, follow" />
				<meta property="og:locale" content={ogLocales[locale]} />
				{useLocalizedFallback &&
					i18n.locales
						.filter((language) => language !== locale)
						.map((language) => (
							<meta
								key={language}
								property="og:locale:alternate"
								content={ogLocales[language]}
							/>
						))}
				<meta name="twitter:title" content={format(title)} />
				<meta name="twitter:description" content={description} />
				<meta property="og:image" content={imageUrl} />
				<meta name="twitter:image" content={imageUrl} />
				<meta
					name="twitter:image:alt"
					content={messages["seo.imageAlt"].message}
				/>
				<meta
					property="og:image:alt"
					content={messages["seo.imageAlt"].message}
				/>
			</Head>
			{useLocalizedFallback && (
				<main className="container margin-vert--xl">
					<h1 className="hero__title">{title}</h1>
					<p>{description}</p>
					<p>{messages["theme.NotFound.p2"].message}</p>
					<ul>
						<li>
							<a href={baseUrl}>{messages["notFound.home"].message}</a>
						</li>
						<li>
							<a href={`${baseUrl}docs/intro`}>
								{messages["notFound.docs"].message}
							</a>
						</li>
						<li>
							<a href={englishUrl} lang="en">
								English
							</a>
						</li>
					</ul>
				</main>
			)}
		</>
	);
}
