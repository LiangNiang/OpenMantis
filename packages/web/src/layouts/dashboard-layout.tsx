import { useCallback, useMemo, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { RestartBanner } from "@/components/restart-banner";
import type { ProviderEntry } from "@/components/provider-form";
import { HAS_CONFIG_TOOLS, type ToolsFormValues } from "@/components/tools-form";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useConfig } from "@/hooks/use-config";
import { useLocale } from "@/i18n";
import type {
	AdvancedValues,
	ChannelsValues,
	DashboardOutletContext,
	ProviderValues,
} from "./dashboard-context";

const SECTION_IDS = ["provider", "channels", "tools", "advanced"] as const;
type SectionId = (typeof SECTION_IDS)[number];

const SECTION_KEYS: Record<SectionId, string[]> = {
	provider: ["defaultProvider", "providers"],
	channels: ["channels", "feishu", "wecom", "qq"],
	tools: ["excludeTools", "tavily", "exa", "whisper", "xiaomiTts", "bash", "browser"],
	advanced: ["systemPrompt", "maxToolRoundtrips"],
};

const SECTION_ICONS: Record<SectionId, React.ReactNode> = {
	provider: (
		<svg className="size-4" viewBox="0 0 16 16" fill="none">
			<path
				d="M8 1v4M8 11v4M1 8h4M11 8h4M3.05 3.05l2.83 2.83M10.12 10.12l2.83 2.83M3.05 12.95l2.83-2.83M10.12 5.88l2.83-2.83"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
		</svg>
	),
	channels: (
		<svg className="size-4" viewBox="0 0 16 16" fill="none">
			<path
				d="M14 5l-6 3.5L2 5M2 5v6l6 3.5L14 11V5M2 5l6-3.5L14 5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	),
	tools: (
		<svg className="size-4" viewBox="0 0 16 16" fill="none">
			<path
				d="M9.5 2.5l4 4-7.5 7.5H2V10z"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path d="M8 4l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	),
	advanced: (
		<svg className="size-4" viewBox="0 0 16 16" fill="none">
			<circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" />
			<path
				d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
		</svg>
	),
};

export function DashboardLayout() {
	const { t } = useLocale();
	const { config, loading, error, updateConfig, resetConfig } = useConfig();

	if (loading) {
		return (
			<div className="min-h-screen bg-background flex items-center justify-center">
				<div className="flex flex-col items-center gap-3">
					<div className="size-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
					<p className="text-muted-foreground text-sm">{t("dashboard.loadingConfig")}</p>
				</div>
			</div>
		);
	}

	if (!config) {
		return <Navigate to="/wizard" replace />;
	}

	return (
		<DashboardLayoutInner
			key={JSON.stringify(config)}
			config={config}
			error={error}
			updateConfig={updateConfig}
			resetConfig={resetConfig}
		/>
	);
}

interface InnerProps {
	config: Record<string, any>;
	error: string | null;
	updateConfig: (partial: Record<string, any>) => Promise<void>;
	resetConfig: (keys?: string[]) => Promise<void>;
}

function DashboardLayoutInner({ config, error, updateConfig, resetConfig }: InnerProps) {
	const { t } = useLocale();
	const location = useLocation();
	const navigate = useNavigate();

	const rawSegment = location.pathname.replace(/^\//, "") || "provider";
	const activeSection: SectionId = (SECTION_IDS as readonly string[]).includes(rawSegment)
		? (rawSegment as SectionId)
		: "provider";
	const isLogsRoute = location.pathname === "/logs";

	const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const [saveError, setSaveError] = useState<string | null>(null);
	const [showResetConfirm, setShowResetConfirm] = useState(false);

	const sections = useMemo(
		() =>
			SECTION_IDS.map((id) => ({
				id,
				label: t(`dashboard.section.${id}.label`),
				description: t(`dashboard.section.${id}.description`),
			})),
		[t],
	);

	const configProviders: ProviderEntry[] = (config.providers ?? []).map((p: any) => {
		const normalizeModel = (raw: any) =>
			typeof raw === "object" && raw !== null
				? {
						id: raw.id ?? "",
						alias: raw.alias,
						reasoningEffort: raw.reasoningEffort ?? "auto",
						temperature: raw.temperature,
						topP: raw.topP,
						providerOptions: raw.providerOptions,
					}
				: { id: raw ?? "", reasoningEffort: "auto" as const };
		const rawModels = Array.isArray(p.models) ? p.models : undefined;
		const models =
			rawModels && rawModels.length > 0
				? rawModels.map(normalizeModel)
				: [normalizeModel(p.model)];
		return {
			name: p.name ?? "",
			provider: p.provider ?? "openai",
			models,
			apiKey: p.apiKey ?? "",
			baseUrl: p.baseUrl ?? "",
			webSearch: p.webSearch,
		};
	});

	const [providerValues, setProviderValues] = useState<ProviderValues>({
		defaultProvider: config.defaultProvider ?? "default",
		providers: configProviders,
	});

	const [channelsValues, setChannelsValues] = useState<ChannelsValues>({
		channels: config.channels ?? [],
		feishu: Array.isArray(config.feishu)
			? config.feishu.map((app: any) => ({
					tts: { enabled: false, provider: "xiaomi-mimo" as const },
					...app,
				}))
			: undefined,
		wecom: config.wecom
			? { tts: { enabled: false, provider: "xiaomi-mimo" }, ...config.wecom }
			: undefined,
		qq: config.qq,
	});

	const hasCredential: Record<(typeof HAS_CONFIG_TOOLS)[number], boolean> = {
		tavily: !!config.tavily?.apiKey,
		exa: !!config.exa?.apiKey,
whisper: !!config.whisper?.apiKey,
	};
	const [toolsValues, setToolsValues] = useState<ToolsFormValues>({
		excludeTools: Array.from(
			new Set([
				...(config.excludeTools ?? []),
				...HAS_CONFIG_TOOLS.filter((tool) => !hasCredential[tool]),
			]),
		),
		tavily: config.tavily,
		exa: config.exa,
whisper: config.whisper,
		xiaomiTts: config.xiaomiTts,
		bash: config.bash,
		browser: config.browser,
	});

	const [advancedValues, setAdvancedValues] = useState<AdvancedValues>({
		systemPrompt: config.systemPrompt ?? "",
		maxToolRoundtrips: config.maxToolRoundtrips ?? 10,
	});

	const formValuesMap = useMemo<Record<SectionId, Record<string, any>>>(
		() => ({
			provider: providerValues,
			channels: channelsValues,
			tools: toolsValues,
			advanced: advancedValues,
		}),
		[providerValues, channelsValues, toolsValues, advancedValues],
	);

	const handleSave = useCallback(async () => {
		setSaveStatus("saving");
		setSaveError(null);
		try {
			const formValues = formValuesMap[activeSection] ?? {};
			const keys = SECTION_KEYS[activeSection];
			const partial: Record<string, any> = {};
			for (const key of keys) {
				if (key in formValues) {
					partial[key] = formValues[key];
				}
			}
			await updateConfig(partial);
			setSaveStatus("saved");
			setTimeout(() => setSaveStatus("idle"), 2000);
		} catch (err) {
			setSaveStatus("error");
			setSaveError(err instanceof Error ? err.message : t("common.saveFailed"));
		}
	}, [activeSection, formValuesMap, updateConfig, t]);

	const handleReset = useCallback(async () => {
		try {
			const keys = SECTION_KEYS[activeSection];
			await resetConfig(keys);
			setShowResetConfirm(false);
			setSaveStatus("idle");
			setSaveError(null);
		} catch {
			// error handled by useConfig
		}
	}, [activeSection, resetConfig]);

	const currentSection = sections.find((s) => s.id === activeSection)!;
	const providerNames = useMemo(
		() => providerValues.providers.map((p) => p.name),
		[providerValues.providers],
	);

	const outletContext: DashboardOutletContext = useMemo(
		() => ({
			providerValues,
			setProviderValues,
			channelsValues,
			setChannelsValues,
			toolsValues,
			setToolsValues,
			advancedValues,
			setAdvancedValues,
			providerNames,
		}),
		[providerValues, channelsValues, toolsValues, advancedValues, providerNames],
	);

	return (
		<div className="min-h-screen flex flex-col">
			<RestartBanner />
			<div className="flex-1 min-h-0 bg-background text-foreground flex relative noise">
			<div className="fixed inset-0 pointer-events-none overflow-hidden">
				<div className="absolute -top-1/3 right-0 w-1/3 h-2/3 rounded-full bg-primary/2 blur-[150px]" />
				<div className="absolute bottom-0 -left-1/4 w-1/3 h-1/3 rounded-full bg-warm/2 blur-[120px]" />
			</div>

			<aside className="w-64 border-r border-border/60 flex flex-col z-10 bg-sidebar/50 backdrop-blur-sm sticky top-0 h-screen">
				<div className="p-5 flex items-center justify-between">
					<div>
						<h1 className="font-display text-lg font-bold tracking-tight">
							<span className="text-primary">Open</span>
							<span>Mantis</span>
						</h1>
						<p className="text-[11px] text-muted-foreground tracking-wide uppercase mt-0.5">
							{t("common.configuration")}
						</p>
					</div>
					<LocaleSwitcher />
				</div>
				<Separator className="opacity-40" />
				<nav className="flex-1 p-3">
					<p className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.15em]">
						{t("dashboard.settings")}
					</p>
					{sections.map((section) => (
						<NavLink
							key={section.id}
							to={`/${section.id}`}
							onClick={() => {
								setSaveStatus("idle");
								setSaveError(null);
							}}
							className={({ isActive }) =>
								`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2.5 transition-all duration-200 ${
									isActive
										? "bg-accent text-accent-foreground font-medium"
										: "text-muted-foreground hover:text-foreground hover:bg-accent/50"
								}`
							}
						>
							{({ isActive }) => (
								<>
									<span className={isActive ? "text-primary" : ""}>
										{SECTION_ICONS[section.id]}
									</span>
									{section.label}
								</>
							)}
						</NavLink>
					))}
					<Separator className="opacity-40 my-3" />
					<p className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.15em]">
						{t("dashboard.management")}
					</p>
					<span className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-muted-foreground/50 cursor-not-allowed">
						<svg className="size-4" viewBox="0 0 16 16" fill="none">
							<rect
								x="2"
								y="2"
								width="12"
								height="12"
								rx="2"
								stroke="currentColor"
								strokeWidth="1.5"
							/>
							<path
								d="M5 8h6M8 5v6"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
						{t("dashboard.schedulesSoon")}
					</span>
					<NavLink
						to="/logs"
						onClick={() => {
							setSaveStatus("idle");
							setSaveError(null);
						}}
						className={({ isActive }) =>
							`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-2.5 transition-all duration-200 ${
								isActive
									? "bg-accent text-accent-foreground font-medium"
									: "text-muted-foreground hover:text-foreground hover:bg-accent/50"
							}`
						}
					>
						{({ isActive }) => (
							<>
								<span className={isActive ? "text-primary" : ""}>
									<svg className="size-4" viewBox="0 0 16 16" fill="none">
										<path
											d="M2 12h12M2 8h8M2 4h12"
											stroke="currentColor"
											strokeWidth="1.5"
											strokeLinecap="round"
										/>
									</svg>
								</span>
								{t("dashboard.logs")}
							</>
						)}
					</NavLink>
				</nav>
				<Separator className="opacity-40" />
				<div className="p-4">
					<button
						type="button"
						onClick={() => navigate("/wizard")}
						className="text-xs text-muted-foreground hover:text-primary transition-colors duration-200 flex items-center gap-1.5"
					>
						<svg className="size-3.5" viewBox="0 0 16 16" fill="none">
							<path
								d="M2 8a6 6 0 1 1 1.76 4.24"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
							<path
								d="M2 12V8h4"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
						{t("dashboard.rerunWizard")}
					</button>
				</div>
			</aside>

			<main className="flex-1 min-w-0 p-10 relative z-10">
				{!isLogsRoute && (
					<div className="flex items-start justify-between mb-8 animate-fade-in-up">
						<div>
							<h2 className="font-display text-2xl font-semibold tracking-tight">
								{currentSection.label}
							</h2>
							<p className="text-sm text-muted-foreground mt-1">{currentSection.description}</p>
						</div>
						<div className="flex gap-2">
							<Button variant="outline" size="sm" onClick={() => setShowResetConfirm(true)}>
								{t("common.reset")}
							</Button>
							<Button size="sm" onClick={handleSave} disabled={saveStatus === "saving"}>
								{saveStatus === "saving" ? t("common.saving") : t("common.save")}
							</Button>
						</div>
					</div>
				)}

				{!isLogsRoute && saveStatus === "saved" && (
					<div className="flex items-center gap-2 text-primary text-sm mb-6 animate-fade-in px-3 py-2 rounded-lg bg-primary/5 border border-primary/10">
						<svg className="size-4" viewBox="0 0 16 16" fill="none">
							<circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
							<path
								d="M5.5 8.5l2 2 3.5-4"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
						{t("common.savedSuccess")}
					</div>
				)}
				{!isLogsRoute && (saveStatus === "error" || error) && (
					<div className="flex items-center gap-2 text-destructive text-sm mb-6 animate-fade-in px-3 py-2 rounded-lg bg-destructive/5 border border-destructive/10">
						<svg className="size-4" viewBox="0 0 16 16" fill="none">
							<circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
							<path
								d="M8 5v3.5M8 10.5v.5"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
						{saveError ?? error}
					</div>
				)}

				<div className={isLogsRoute ? "h-full" : "animate-fade-in-up delay-150"}>
					<Outlet context={outletContext} />
				</div>
			</main>

			<Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("dialog.resetConfirmTitle")}</DialogTitle>
						<DialogDescription>
							{t("dialog.resetConfirmDescription").replace("{section}", currentSection.label)}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setShowResetConfirm(false)}>
							{t("common.cancel")}
						</Button>
						<Button variant="destructive" onClick={handleReset}>
							{t("common.reset")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			</div>
		</div>
	);
}
