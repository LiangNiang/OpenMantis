import { useConfig } from "@/hooks/use-config";
import { useLocale } from "@/i18n";

export function RestartBanner() {
	const { restartRequired } = useConfig();
	const { t } = useLocale();

	if (!restartRequired) return null;

	return (
		<div className="border-b border-warm/30 bg-warm/10 px-6 py-3 flex items-start gap-3 text-foreground">
			<svg
				className="size-5 mt-0.5 shrink-0 text-warm"
				viewBox="0 0 16 16"
				fill="none"
				aria-hidden="true"
			>
				<circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
				<path
					d="M8 4.5v4M8 11v.5"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
			</svg>
			<div className="text-sm">
				<p className="font-medium">{t("banner.restartRequired.title")}</p>
				<p className="text-muted-foreground mt-0.5">{t("banner.restartRequired.description")}</p>
			</div>
		</div>
	);
}
