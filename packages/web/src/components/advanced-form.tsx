import { useLocale } from "@/i18n"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface AdvancedFormProps {
	values: {
		systemPrompt: string
		maxToolRoundtrips: number
	}
	onChange: (values: AdvancedFormProps["values"]) => void
}

export function AdvancedForm({ values, onChange }: AdvancedFormProps) {
	const { t } = useLocale()
	const update = (key: string, value: string | number) => {
		onChange({ ...values, [key]: value })
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-2">
				<Label>{t("advanced.systemPrompt")}</Label>
				<Textarea
					value={values.systemPrompt}
					onChange={(e) => update("systemPrompt", e.target.value)}
					placeholder={t("advanced.systemPromptPlaceholder")}
					rows={5}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label>{t("advanced.maxToolRoundtrips")}</Label>
				<Input
					type="number"
					value={values.maxToolRoundtrips}
					onChange={(e) => update("maxToolRoundtrips", Number.parseInt(e.target.value, 10) || 10)}
					min={1}
					max={100}
				/>
			</div>
		</div>
	)
}
