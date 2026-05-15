import { useLocale } from "@/i18n";
import { SensitiveInput } from "./sensitive-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface ChannelsFormProps {
	values: {
		channels: string[];
		feishu?: Array<{ name: string; appId: string; appSecret: string }>;
		wecom?: { botId: string; secret: string };
		qq?: { appId: string; clientSecret: string; sandbox: boolean };
	};
	onChange: (values: ChannelsFormProps["values"]) => void;
}

export function ChannelsForm({ values, onChange }: ChannelsFormProps) {
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

	const updateQQ = (key: string, value: string | boolean) => {
		onChange({ ...values, qq: { ...values.qq!, [key]: value } });
	};

	const isEnabled = (ch: string) => values.channels.includes(ch);

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
					</CardContent>
				)}
			</Card>
		</div>
	);
}
