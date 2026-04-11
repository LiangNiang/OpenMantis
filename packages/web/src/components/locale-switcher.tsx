import { useLocale } from "@/i18n"
import { Button } from "@/components/ui/button"

export function LocaleSwitcher() {
	const { locale, setLocale } = useLocale()

	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={() => setLocale(locale === "en" ? "zh" : "en")}
			className="text-muted-foreground hover:text-foreground text-xs font-medium tracking-wide"
		>
			{locale === "en" ? "中" : "EN"}
		</Button>
	)
}
