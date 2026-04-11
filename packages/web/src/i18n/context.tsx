import { createContext, type ReactNode, useCallback, useContext, useState } from "react"
import en from "./locales/en.json"
import zh from "./locales/zh.json"

export type Locale = "en" | "zh"

const messages: Record<Locale, Record<string, string>> = { en, zh }

function detectLocale(): Locale {
	const stored = localStorage.getItem("openmantis-locale")
	if (stored === "en" || stored === "zh") return stored
	return navigator.language.startsWith("zh") ? "zh" : "en"
}

interface LocaleContextValue {
	locale: Locale
	setLocale: (locale: Locale) => void
	t: (key: string) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<Locale>(detectLocale)

	const setLocale = useCallback((next: Locale) => {
		setLocaleState(next)
		localStorage.setItem("openmantis-locale", next)
	}, [])

	const t = useCallback((key: string) => messages[locale][key] ?? key, [locale])

	return <LocaleContext value={{ locale, setLocale, t }}>{children}</LocaleContext>
}

export function useLocale() {
	const ctx = useContext(LocaleContext)
	if (!ctx) throw new Error("useLocale must be used within LocaleProvider")
	return ctx
}
