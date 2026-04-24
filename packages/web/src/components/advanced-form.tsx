import { useLocale } from "@/i18n"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface AdvancedFormProps {
	values: {
		systemPrompt: string
		maxToolRoundtrips: number
		autoNewRoute: {
			enabled: boolean
			idleMinutes: number
			recap: boolean
		}
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
			<div className="flex flex-col gap-2">
				<Label>{t("advanced.autoNewRoute.enabled")}</Label>
				<div className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={values.autoNewRoute.enabled}
						onChange={(e) =>
							onChange({
								...values,
								autoNewRoute: { ...values.autoNewRoute, enabled: e.target.checked },
							})
						}
					/>
					<span className="text-sm text-muted-foreground">
						{t("advanced.autoNewRoute.enabledHint")}
					</span>
				</div>
			</div>
			<div className="flex flex-col gap-2">
				<Label>{t("advanced.autoNewRoute.idleMinutes")}</Label>
				<Input
					type="number"
					value={values.autoNewRoute.idleMinutes}
					onChange={(e) =>
						onChange({
							...values,
							autoNewRoute: {
								...values.autoNewRoute,
								idleMinutes: Number.parseInt(e.target.value, 10) || 120,
							},
						})
					}
					min={1}
					max={10080}
					disabled={!values.autoNewRoute.enabled}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label>{t("advanced.autoNewRoute.recap")}</Label>
				<div className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={values.autoNewRoute.recap}
						onChange={(e) =>
							onChange({
								...values,
								autoNewRoute: { ...values.autoNewRoute, recap: e.target.checked },
							})
						}
						disabled={!values.autoNewRoute.enabled}
					/>
					<span className="text-sm text-muted-foreground">
						{t("advanced.autoNewRoute.recapHint")}
					</span>
				</div>
			</div>
		</div>
	)
}
