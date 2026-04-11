import { useLocale } from "@/i18n";
import { SensitiveInput } from "./sensitive-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface ChannelTts {
	enabled: boolean;
	provider: "xiaomi-mimo";
}

interface ChannelsFormProps {
	values: {
		channels: string[];
		feishu?: Array<{ name: string; appId: string; appSecret: string; provider?: string; tts?: ChannelTts }>;
		wecom?: { botId: string; secret: string; provider?: string; tts?: ChannelTts };
		qq?: { appId: string; clientSecret: string; sandbox: boolean; provider?: string };
	};
	onChange: (values: ChannelsFormProps["values"]) => void;
	providerNames?: string[];
}

const EMPTY_PROVIDER_NAMES: string[] = [];

export function ChannelsForm({ values, onChange, providerNames = EMPTY_PROVIDER_NAMES }: ChannelsFormProps) {
	const { t } = useLocale();
	const toggleChannel = (channel: string, enabled: boolean) => {
		const next = { ...values };
		if (enabled) {
			next.channels = [...next.channels, channel];
			if (channel === "feishu" && !next.feishu) next.feishu = [{ name: "main", appId: "", appSecret: "" }];
			if (channel === "wecom" && !next.wecom) next.wecom = { botId: "", secret: "" };
			if (channel === "qq" && !next.qq) next.qq = { appId: "", clientSecret: "", sandbox: false };
		} else {
			next.channels = next.channels.filter((c) => c !== channel);
		}
		onChange(next);
	};

	const updateFeishuApp = (index: number, key: string, value: string) => {
		const apps = [...(values.feishu ?? [])];
		apps[index] = { ...apps[index], [key]: value };
		onChange({ ...values, feishu: apps });
	};

	const updateFeishuAppTts = (index: number, key: keyof ChannelTts, value: boolean | string) => {
		const apps = [...(values.feishu ?? [])];
		const tts: ChannelTts = { enabled: false, provider: "xiaomi-mimo", ...(apps[index].tts ?? {}), [key]: value };
		apps[index] = { ...apps[index], tts };
		onChange({ ...values, feishu: apps });
	};

	const addFeishuApp = () => {
		const apps = [...(values.feishu ?? [])];
		apps.push({ name: "", appId: "", appSecret: "" });
		onChange({ ...values, feishu: apps });
	};

	const removeFeishuApp = (index: number) => {
		const apps = (values.feishu ?? []).filter((_, i) => i !== index);
		onChange({
			...values,
			feishu: apps.length > 0 ? apps : undefined,
			channels: apps.length > 0 ? values.channels : values.channels.filter((c) => c !== "feishu"),
		});
	};

	const updateWecom = (key: string, value: string) => {
		onChange({ ...values, wecom: { ...values.wecom!, [key]: value } });
	};

	const updateWecomTts = (key: keyof ChannelTts, value: boolean | string) => {
		const tts: ChannelTts = { enabled: false, provider: "xiaomi-mimo", ...(values.wecom?.tts ?? {}), [key]: value };
		onChange({ ...values, wecom: { ...values.wecom!, tts } });
	};

	const updateQQ = (key: string, value: string | boolean) => {
		onChange({ ...values, qq: { ...values.qq!, [key]: value } });
	};

	const isEnabled = (ch: string) => values.channels.includes(ch);

	const providerSelect = (
		currentValue: string | undefined,
		onUpdate: (key: string, value: any) => void,
	) =>
		providerNames.length > 0 ? (
			<div className="flex flex-col gap-2">
				<Label>{t("channels.provider")}</Label>
				<Select
					value={currentValue ?? "__default__"}
					onValueChange={(v) => onUpdate("provider", v === "__default__" ? undefined : v)}
				>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="__default__">{t("channels.useDefaultProvider")}</SelectItem>
						{providerNames.map((name) => (
							<SelectItem key={name} value={name}>
								{name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		) : null;

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<CardTitle className="text-base">{t("channels.feishu")}</CardTitle>
						<Switch
							checked={isEnabled("feishu")}
							onCheckedChange={(v) => toggleChannel("feishu", v)}
						/>
					</div>
				</CardHeader>
				{isEnabled("feishu") && values.feishu && (
					<CardContent className="flex flex-col gap-4">
						{values.feishu.map((app, index) => (
							<div
								key={index}
								className="flex flex-col gap-3 rounded-lg border border-border/60 p-4"
							>
								<div className="flex items-center justify-between">
									<p className="text-sm font-medium">
										{app.name || `App ${index + 1}`}
									</p>
									{values.feishu!.length > 1 && (
										<Button
											variant="ghost"
											size="sm"
											className="text-destructive hover:text-destructive h-auto px-2 py-1 text-xs"
											onClick={() => removeFeishuApp(index)}
										>
											{t("channels.feishu.removeApp")}
										</Button>
									)}
								</div>
								<div className="flex flex-col gap-2">
									<Label>{t("channels.feishu.name")}</Label>
									<Input
										value={app.name}
										onChange={(e) => updateFeishuApp(index, "name", e.target.value)}
										placeholder="main"
									/>
									<p className="text-xs text-muted-foreground">
										{t("channels.feishu.name.helper")}
									</p>
								</div>
								<div className="flex flex-col gap-2">
									<Label>{t("channels.appId")}</Label>
									<Input
										value={app.appId}
										onChange={(e) => updateFeishuApp(index, "appId", e.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label>{t("channels.appSecret")}</Label>
									<SensitiveInput
										value={app.appSecret}
										onChange={(v) => updateFeishuApp(index, "appSecret", v)}
									/>
								</div>
								{providerSelect(app.provider, (key, value) => updateFeishuApp(index, key, value))}
								<div className="flex flex-col gap-3 pt-1">
									<p className="text-sm font-medium">{t("feishu.tts.title")}</p>
									<div className="flex items-center justify-between">
										<div>
											<Label className="font-normal">{t("feishu.tts.enabled.label")}</Label>
											<p className="text-xs text-muted-foreground">{t("feishu.tts.enabled.helper")}</p>
										</div>
										<Switch
											checked={app.tts?.enabled ?? false}
											onCheckedChange={(v) => updateFeishuAppTts(index, "enabled", v)}
										/>
									</div>
									{(app.tts?.enabled ?? false) && (
										<div className="flex flex-col gap-2">
											<Label>{t("feishu.tts.provider.label")}</Label>
											<Select
												value={app.tts?.provider ?? "xiaomi-mimo"}
												onValueChange={(v) => updateFeishuAppTts(index, "provider", v)}
											>
												<SelectTrigger>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="xiaomi-mimo">Xiaomi MiMo TTS</SelectItem>
												</SelectContent>
											</Select>
										</div>
									)}
								</div>
							</div>
						))}
						<Button
							variant="outline"
							size="sm"
							className="w-full"
							onClick={addFeishuApp}
						>
							{t("channels.feishu.addApp")}
						</Button>
					</CardContent>
				)}
			</Card>

			<Card>
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<CardTitle className="text-base">{t("channels.wecom")}</CardTitle>
						<Switch
							checked={isEnabled("wecom")}
							onCheckedChange={(v) => toggleChannel("wecom", v)}
						/>
					</div>
				</CardHeader>
				{isEnabled("wecom") && values.wecom && (
					<CardContent className="flex flex-col gap-3">
						<div className="flex flex-col gap-2">
							<Label>{t("channels.botId")}</Label>
							<Input
								value={values.wecom.botId}
								onChange={(e) => updateWecom("botId", e.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label>{t("channels.secret")}</Label>
							<SensitiveInput
								value={values.wecom.secret}
								onChange={(v) => updateWecom("secret", v)}
							/>
						</div>
						{providerSelect(values.wecom.provider, updateWecom)}
						<div className="flex flex-col gap-3 pt-1">
							<p className="text-sm font-medium">{t("wecom.tts.title")}</p>
							<div className="flex items-center justify-between">
								<div>
									<Label className="font-normal">{t("wecom.tts.enabled.label")}</Label>
									<p className="text-xs text-muted-foreground">{t("wecom.tts.enabled.helper")}</p>
								</div>
								<Switch
									checked={values.wecom.tts?.enabled ?? false}
									onCheckedChange={(v) => updateWecomTts("enabled", v)}
								/>
							</div>
							{(values.wecom.tts?.enabled ?? false) && (
								<div className="flex flex-col gap-2">
									<Label>{t("wecom.tts.provider.label")}</Label>
									<Select
										value={values.wecom.tts?.provider ?? "xiaomi-mimo"}
										onValueChange={(v) => updateWecomTts("provider", v)}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="xiaomi-mimo">Xiaomi MiMo TTS</SelectItem>
										</SelectContent>
									</Select>
								</div>
							)}
						</div>
					</CardContent>
				)}
			</Card>

			<Card>
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<CardTitle className="text-base">QQ</CardTitle>
						<Switch checked={isEnabled("qq")} onCheckedChange={(v) => toggleChannel("qq", v)} />
					</div>
				</CardHeader>
				{isEnabled("qq") && values.qq && (
					<CardContent className="flex flex-col gap-3">
						<div className="flex flex-col gap-2">
							<Label>{t("channels.appId")}</Label>
							<Input value={values.qq.appId} onChange={(e) => updateQQ("appId", e.target.value)} />
						</div>
						<div className="flex flex-col gap-2">
							<Label>{t("channels.clientSecret")}</Label>
							<SensitiveInput
								value={values.qq.clientSecret}
								onChange={(v) => updateQQ("clientSecret", v)}
							/>
						</div>
						<div className="flex items-center gap-2">
							<Switch checked={values.qq.sandbox} onCheckedChange={(v) => updateQQ("sandbox", v)} />
							<Label>{t("channels.sandbox")}</Label>
						</div>
						{providerSelect(values.qq.provider, updateQQ)}
					</CardContent>
				)}
			</Card>
		</div>
	);
}
