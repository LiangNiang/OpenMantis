import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { App } from "./App"
import { LocaleProvider } from "@/i18n"

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<LocaleProvider>
			<App />
		</LocaleProvider>
	</StrictMode>,
)
