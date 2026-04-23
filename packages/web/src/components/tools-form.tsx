import { useLocale } from "@/i18n";
import { SensitiveInput } from "./sensitive-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** Tool groups whose backend registration depends on user-supplied credentials.
 * These default to disabled in the UI when their config is missing. */
export const HAS_CONFIG_TOOLS = ["tavily", "exa", "whisper"] as const;

export interface ToolsFormValues {
	excludeTools: string[];
	tavily?: { apiKey: string };
	exa?: { apiKey?: string };
whisper?: { apiKey?: string; baseUrl?: string };
	xiaomiTts?: {
		enabled: boolean;
		apiKey?: string;
		baseUrl?: string;
		voice: string;
		style?: string;
		direction?: string;
		stream: boolean;
	};
	bash?: { timeout: number; maxOutputLength: number; silenceTimeout: number };
	browser?: {
		enabled: boolean;
		binPath?: string;
		cdp?: { port?: number; autoConnect?: boolean } | null;
	};
}

const TOOL_GROUPS = [
	{ id: "bash", label: "Bash", descriptionKey: "tools.bash" },
	{ id: "search", label: "Search", descriptionKey: "tools.search" },
	{ id: "skills", label: "Skills", descriptionKey: "tools.skills" },
	{ id: "time", label: "Time", descriptionKey: "tools.time" },
	{ id: "tavily", label: "Tavily", descriptionKey: "tools.tavily", hasConfig: true },
	{ id: "exa", label: "Exa", descriptionKey: "tools.exa", hasConfig: true },
{ id: "schedule", label: "Schedule", descriptionKey: "tools.schedule" },
	{ id: "rss", label: "RSS", descriptionKey: "tools.rss" },
	{ id: "whisper", label: "Whisper", descriptionKey: "tools.whisper", hasConfig: true },
];

const DEFAULT_XIAOMI_TTS = {
	enabled: false,
	voice: "mimo_default",
	style: "",
	direction: "",
	stream: true,
};

const XIAOMI_TTS_VOICES: Array<{ value: string; labelKey?: string }> = [
	{ value: "mimo_default", labelKey: "xiaomiTts.voiceMimoDefault" },
	{ value: "冰糖" },
	{ value: "茉莉" },
	{ value: "苏打" },
	{ value: "白桦" },
	{ value: "Mia" },
	{ value: "Chloe" },
	{ value: "Milo" },
	{ value: "Dean" },
];

const XIAOMI_TTS_STYLE_PRESETS = [
	// 基础情绪
	"开心", "悲伤", "愤怒", "惊讶", "兴奋", "平静",
	// 复合情绪
	"怅然", "欣慰", "无奈", "释然",
	// 整体语调
	"温柔", "高冷", "活泼", "严肃", "慵懒",
	// 音色定位
	"磁性", "醇厚", "清亮", "甜美", "沙哑",
	// 人设腔调
	"夹子音", "御姐音", "正太音", "大叔音", "台湾腔",
	// 方言
	"东北话", "四川话", "河南话", "粤语",
	// 角色扮演
	"孙悟空", "林黛玉",
	// 唱歌
	"唱歌",
];

interface ToolsFormProps {
	values: ToolsFormValues;
	onChange: (values: ToolsFormValues) => void;
}

export function ToolsForm({ values, onChange }: ToolsFormProps) {
	const { t } = useLocale();
	const isEnabled = (id: string) => !values.excludeTools.includes(id);

	const toggleTool = (id: string, enabled: boolean) => {
		const next = { ...values };
		if (enabled) {
			next.excludeTools = next.excludeTools.filter((t) => t !== id);
		} else {
			next.excludeTools = [...next.excludeTools, id];
		}
		onChange(next);
	};

	const updateNested = (section: string, key: string, value: string | number) => {
		onChange({ ...values, [section]: { ...(values as any)[section], [key]: value } });
	};

	const updateBrowser = (key: string, value: string | boolean) => {
		onChange({
			...values,
			browser: { enabled: false, ...values.browser, [key]: value },
		});
	};

	const updateXiaomiTts = (key: string, value: string | boolean) => {
		onChange({
			...values,
			xiaomiTts: { ...DEFAULT_XIAOMI_TTS, ...(values.xiaomiTts ?? {}), [key]: value },
		});
	};

	return (
		<div className="flex flex-col gap-4">
			{TOOL_GROUPS.map((tool) => (
				<Card key={tool.id}>
					<CardHeader className="pb-3">
						<div className="flex items-center justify-between">
							<div>
								<CardTitle className="text-base">{tool.label}</CardTitle>
								<p className="text-sm text-muted-foreground">{t(tool.descriptionKey)}</p>
							</div>
							<Switch
								checked={isEnabled(tool.id)}
								onCheckedChange={(v) => toggleTool(tool.id, v)}
							/>
						</div>
					</CardHeader>
					{tool.id === "tavily" && isEnabled("tavily") && (
						<CardContent className="flex flex-col gap-3">
							<div className="flex flex-col gap-2">
								<Label>{t("tools.apiKey")}</Label>
								<SensitiveInput
									value={values.tavily?.apiKey ?? ""}
									onChange={(v) => updateNested("tavily", "apiKey", v)}
									placeholder="tvly-..."
								/>
							</div>
						</CardContent>
					)}
					{tool.id === "exa" && isEnabled("exa") && (
						<CardContent className="flex flex-col gap-3">
							<div className="flex flex-col gap-2">
								<Label>{t("tools.apiKey")}</Label>
								<SensitiveInput
									value={values.exa?.apiKey ?? ""}
									onChange={(v) => updateNested("exa", "apiKey", v)}
								/>
							</div>
						</CardContent>
					)}
{tool.id === "whisper" && isEnabled("whisper") && (
						<CardContent className="flex flex-col gap-3">
							<div className="flex flex-col gap-2">
								<Label>{t("tools.apiKeyOptional")}</Label>
								<SensitiveInput
									value={values.whisper?.apiKey ?? ""}
									onChange={(v) => updateNested("whisper", "apiKey", v)}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label>{t("tools.baseUrlOptional")}</Label>
								<Input
									value={values.whisper?.baseUrl ?? ""}
									onChange={(e) => updateNested("whisper", "baseUrl", e.target.value)}
								/>
							</div>
						</CardContent>
					)}
				</Card>
			))}

			{/* Xiaomi TTS — standalone top-level config section */}
			<Card>
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<div>
							<CardTitle className="text-base">{t("xiaomiTts.title")}</CardTitle>
							<p className="text-sm text-muted-foreground">{t("xiaomiTts.description")}</p>
						</div>
						<Switch
							checked={values.xiaomiTts?.enabled ?? false}
							onCheckedChange={(v) => updateXiaomiTts("enabled", v)}
						/>
					</div>
				</CardHeader>
				{(values.xiaomiTts?.enabled ?? false) && (
					<CardContent className="flex flex-col gap-4">
						<div className="flex flex-col gap-2">
							<Label>{t("xiaomiTts.apiKey")}</Label>
							<p className="text-xs text-muted-foreground">{t("xiaomiTts.apiKeyHelper")}</p>
							<SensitiveInput
								value={values.xiaomiTts?.apiKey ?? ""}
								onChange={(v) => updateXiaomiTts("apiKey", v)}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label>{t("tools.baseUrlOptional")}</Label>
							<Input
								value={values.xiaomiTts?.baseUrl ?? ""}
								placeholder="https://api.xiaomimimo.com/v1"
								onChange={(e) => updateXiaomiTts("baseUrl", e.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label>{t("xiaomiTts.voice")}</Label>
							<Select
								value={values.xiaomiTts?.voice ?? "mimo_default"}
								onValueChange={(v) => updateXiaomiTts("voice", v)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{XIAOMI_TTS_VOICES.map((v) => (
										<SelectItem key={v.value} value={v.value}>
											{v.labelKey ? t(v.labelKey) : v.value}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-2">
							<Label>{t("xiaomiTts.style.label")}</Label>
							<p className="text-xs text-muted-foreground">{t("xiaomiTts.style.helper")}</p>
							<Input
								value={values.xiaomiTts?.style ?? ""}
								placeholder={t("xiaomiTts.style.placeholder")}
								onChange={(e) => updateXiaomiTts("style", e.target.value)}
							/>
							<div className="flex flex-col gap-1.5">
								<p className="text-xs text-muted-foreground">{t("xiaomiTts.style.presets")}</p>
								<div className="flex flex-wrap gap-1.5">
									{XIAOMI_TTS_STYLE_PRESETS.map((preset) => (
										<button
											key={preset}
											type="button"
											onClick={() => updateXiaomiTts("style", preset)}
											className={`px-2 py-0.5 rounded-full text-xs border transition-colors cursor-pointer ${
												(values.xiaomiTts?.style ?? "") === preset
													? "bg-primary text-primary-foreground border-primary"
													: "border-border text-muted-foreground hover:border-primary hover:text-foreground"
											}`}
										>
											{preset}
										</button>
									))}
								</div>
							</div>
						</div>
						<div className="flex flex-col gap-2">
							<Label>{t("xiaomiTts.direction.label")}</Label>
							<p className="text-xs text-muted-foreground">{t("xiaomiTts.direction.helper")}</p>
							<Textarea
								value={values.xiaomiTts?.direction ?? ""}
								placeholder={t("xiaomiTts.direction.placeholder")}
								onChange={(e) => updateXiaomiTts("direction", e.target.value)}
								rows={3}
							/>
						</div>
						<div className="flex items-center justify-between">
							<div>
								<Label>{t("xiaomiTts.stream")}</Label>
								<p className="text-sm text-muted-foreground">{t("xiaomiTts.streamDescription")}</p>
							</div>
							<Switch
								checked={values.xiaomiTts?.stream ?? true}
								onCheckedChange={(v) => updateXiaomiTts("stream", v)}
							/>
						</div>
					</CardContent>
				)}
			</Card>

			{/* Browser automation — standalone top-level config section */}
			<Card>
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<div>
							<CardTitle className="text-base">{t("browser.title")}</CardTitle>
							<p className="text-sm text-muted-foreground">{t("browser.description")}</p>
						</div>
						<Switch
							checked={values.browser?.enabled ?? false}
							onCheckedChange={(v) => updateBrowser("enabled", v)}
						/>
					</div>
				</CardHeader>
				{(values.browser?.enabled ?? false) && (
					<CardContent className="flex flex-col gap-3">
						<div className="flex flex-col gap-2">
							<Label>{t("browser.binPath")}</Label>
							<p className="text-xs text-muted-foreground">{t("browser.binPathHelper")}</p>
							<Input
								value={values.browser?.binPath ?? ""}
								placeholder="agent-browser"
								onChange={(e) => updateBrowser("binPath", e.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label>{t("browser.cdp.mode")}</Label>
							<p className="text-xs text-muted-foreground">{t("browser.cdp.helper")}</p>
							<Select
								value={
									values.browser?.cdp?.autoConnect
										? "auto"
										: typeof values.browser?.cdp?.port === "number"
											? "port"
											: "off"
								}
								onValueChange={(mode) => {
									const next = { ...values };
									const base = { enabled: false, ...next.browser };
									if (mode === "off") {
										const { cdp: _omit, ...rest } = base;
										next.browser = { ...rest, cdp: null };
									} else if (mode === "auto") {
										next.browser = { ...base, cdp: { autoConnect: true } };
									} else {
										next.browser = { ...base, cdp: { port: 9222 } };
									}
									onChange(next);
								}}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="off">{t("browser.cdp.modeOff")}</SelectItem>
									<SelectItem value="auto">{t("browser.cdp.modeAuto")}</SelectItem>
									<SelectItem value="port">{t("browser.cdp.modePort")}</SelectItem>
								</SelectContent>
							</Select>
						</div>
						{typeof values.browser?.cdp?.port === "number" && (
							<div className="flex flex-col gap-2">
								<Label>{t("browser.cdp.port")}</Label>
								<Input
									type="number"
									min={1}
									max={65535}
									value={values.browser.cdp.port}
									onChange={(e) => {
										const port = Number.parseInt(e.target.value, 10);
										onChange({
											...values,
											browser: {
												enabled: false,
												...values.browser,
												cdp: { port: Number.isFinite(port) ? port : 9222 },
											},
										});
									}}
								/>
							</div>
						)}
					</CardContent>
				)}
			</Card>
		</div>
	);
}
