import { useState } from "react";
import { AdvancedForm } from "@/components/advanced-form";
import { ChannelsForm } from "@/components/channels-form";
import { LocaleSwitcher } from "@/components/locale-switcher";
import type { ProviderEntry } from "@/components/provider-form";
import { ProviderForm } from "@/components/provider-form";
import { HAS_CONFIG_TOOLS, ToolsForm, type ToolsFormValues } from "@/components/tools-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useConfig } from "@/hooks/use-config";
import { useLocale } from "@/i18n";

const STEP_KEYS = [
	{ titleKey: "wizard.step.provider.title", descriptionKey: "wizard.step.provider.description" },
	{ titleKey: "wizard.step.channels.title", descriptionKey: "wizard.step.channels.description" },
	{ titleKey: "wizard.step.tools.title", descriptionKey: "wizard.step.tools.description" },
	{ titleKey: "wizard.step.advanced.title", descriptionKey: "wizard.step.advanced.description" },
];

interface WizardProps {
	onComplete: () => void;
	onCancel?: () => void;
}

export function Wizard({ onComplete, onCancel }: WizardProps) {
	const { t } = useLocale();
	const { updateConfig } = useConfig();
	const [step, setStep] = useState(0);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [providerValues, setProviderValues] = useState<{
		defaultProvider: string;
		providers: ProviderEntry[];
	}>({
		defaultProvider: "default",
		providers: [],
	});

	const [channelsValues, setChannelsValues] = useState<{
		channels: string[];
		feishu?: Array<{ name: string; appId: string; appSecret: string; provider?: string }>;
		wecom?: { botId: string; secret: string; provider?: string };
		qq?: { appId: string; clientSecret: string; sandbox: boolean; provider?: string };
	}>({ channels: [] });

	const [toolsValues, setToolsValues] = useState<ToolsFormValues>({
		excludeTools: [...HAS_CONFIG_TOOLS],
	});

	const [advancedValues, setAdvancedValues] = useState({
		systemPrompt: "",
		maxToolRoundtrips: 50,
	});

	const canProceed = step !== 0 || providerValues.providers.length > 0;

	const handleFinish = async () => {
		setSaving(true);
		setError(null);
		try {
			const config: Record<string, any> = {
				...providerValues,
				...channelsValues,
				...toolsValues,
				...advancedValues,
			};
			for (const key of Object.keys(config)) {
				if (config[key] === undefined) {
					delete config[key];
				}
			}
			await updateConfig(config);
			onComplete();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("common.saveFailed"));
		} finally {
			setSaving(false);
		}
	};

	const isLastStep = step === STEP_KEYS.length - 1;
	const providerNames = providerValues.providers.map((p) => p.name);

	return (
		<div className="min-h-screen bg-background text-foreground flex flex-col items-center py-16 px-4 relative noise">
			{onCancel && (
				<div className="absolute top-5 left-5 z-10">
					<Button
						variant="ghost"
						size="sm"
						onClick={onCancel}
						className="text-muted-foreground hover:text-foreground"
					>
						<svg className="size-4 mr-1" viewBox="0 0 16 16" fill="none">
							<path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
						</svg>
						{t("wizard.backToDashboard")}
					</Button>
				</div>
			)}
			<div className="absolute top-5 right-5 z-10">
				<LocaleSwitcher />
			</div>

			{/* Background decoration */}
			<div className="fixed inset-0 pointer-events-none overflow-hidden">
				<div className="absolute -top-1/4 -right-1/4 w-1/2 h-1/2 rounded-full bg-primary/[0.03] blur-[120px]" />
				<div className="absolute -bottom-1/4 -left-1/4 w-1/2 h-1/2 rounded-full bg-warm/[0.03] blur-[120px]" />
			</div>

			<div className="w-full max-w-2xl relative z-10">
				{/* Brand */}
				<div className="text-center mb-10 animate-fade-in-up">
					<h1 className="font-display text-3xl font-bold tracking-tight mb-1">
						<span className="text-primary">Open</span>
						<span>Mantis</span>
					</h1>
					<p className="text-muted-foreground text-sm">{t("wizard.subtitle")}</p>
				</div>

				{/* Step indicator */}
				<div className="flex items-center justify-center mb-10 animate-fade-in-up delay-75">
					{STEP_KEYS.map((s, i) => (
						<div key={s.titleKey} className="flex items-center">
							<div
								className={`size-9 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${
									i < step
										? "bg-primary text-primary-foreground mantis-glow-sm"
										: i === step
											? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background"
											: "bg-muted text-muted-foreground border border-border"
								}`}
							>
								{i < step ? (
									<svg className="size-4" viewBox="0 0 16 16" fill="none">
										<path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
									</svg>
								) : (
									i + 1
								)}
							</div>
							{i < STEP_KEYS.length - 1 && (
								<div className="w-14 h-px mx-2 relative">
									<div className="absolute inset-0 bg-border" />
									<div
										className="absolute inset-y-0 left-0 bg-primary transition-all duration-500"
										style={{ width: i < step ? "100%" : "0%" }}
									/>
								</div>
							)}
						</div>
					))}
				</div>

				{/* Step title */}
				<div className="mb-6 animate-fade-in-up delay-150">
					<h2 className="font-display text-xl font-semibold tracking-tight">
						{t(STEP_KEYS[step].titleKey)}
					</h2>
					<p className="text-sm text-muted-foreground mt-1">
						{t(STEP_KEYS[step].descriptionKey)}
					</p>
				</div>

				{/* Content card */}
				<Card className="border-border/60 bg-card/80 backdrop-blur-sm animate-fade-in-up delay-200">
					<CardContent className="pt-6">
						{step === 0 && <ProviderForm values={providerValues} onChange={setProviderValues} />}
						{step === 1 && (
							<ChannelsForm
								values={channelsValues}
								onChange={setChannelsValues}
								providerNames={providerNames}
							/>
						)}
						{step === 2 && <ToolsForm values={toolsValues} onChange={setToolsValues} />}
						{step === 3 && <AdvancedForm values={advancedValues} onChange={setAdvancedValues} />}
					</CardContent>
				</Card>

				{error && (
					<p className="text-destructive text-sm mt-4 text-center animate-fade-in">{error}</p>
				)}

				{/* Navigation */}
				<div className="flex justify-between mt-8 animate-fade-in-up delay-300">
					<Button
						variant="ghost"
						onClick={() => setStep((s) => s - 1)}
						disabled={step === 0}
						className="text-muted-foreground hover:text-foreground"
					>
						{t("common.back")}
					</Button>
					<div className="flex gap-3">
						{step > 0 && !isLastStep && (
							<Button
								variant="ghost"
								onClick={() => setStep((s) => s + 1)}
								className="text-muted-foreground hover:text-foreground"
							>
								{t("common.skip")}
							</Button>
						)}
						{isLastStep ? (
							<Button onClick={handleFinish} disabled={saving || !canProceed}>
								{saving ? t("common.saving") : t("common.finish")}
							</Button>
						) : (
							<Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed}>
								{t("common.next")}
							</Button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
