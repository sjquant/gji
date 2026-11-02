import { TitleFormatterProvider } from "@docusaurus/theme-common/internal";
import type { ComponentProps, ReactNode } from "react";

type Formatter = ComponentProps<typeof TitleFormatterProvider>["formatter"];

const formatter: Formatter = ({ title, siteTitle, titleDelimiter }) =>
	!title || title === siteTitle
		? siteTitle
		: `${siteTitle} ${titleDelimiter} ${title}`;

export default function ThemeProviderTitleFormatter({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<TitleFormatterProvider formatter={formatter}>
			{children}
		</TitleFormatterProvider>
	);
}
