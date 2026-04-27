import { useState } from "react";
import { useLocale } from "@/i18n";
import { api } from "@/lib/api";
import { SensitiveInput } from "./sensitive-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

export type ReasoningEffort = "off" | "auto" | "minimal" | "low" | "medium" | "high" | "max";

export interface ModelConfig {
	id: string;
	alias?: string;
	reasoningEffort?: ReasoningEffort;
	temperature?: number;
	topP?: number;
	providerOptions?: Record<string, unknown>;
}

const PROVIDER_TYPES = [
	{ value: "openai", label: "OpenAI" },
	{ value: "anthropic", label: "Anthropic" },
	{ value: "bytedance", label: "Bytedance (Doubao)" },
{ value: "xiaomi-mimo", label: "Xiaomi MIMO" },
	{ value: "deepseek", label: "DeepSeek" },
	{ value: "openai-compatible", label: "OpenAI Compatible" },
];

const PROVIDER_BASE_URLS: Record<string, string> = {
	openai: "",
	anthropic: "",
	bytedance: "https://ark.cn-beijing.volces.com/api/v3",
"xiaomi-mimo": "https://api.xiaomimimo.com/v1",
	deepseek: "https://api.deepseek.com/v1",
	"openai-compatible": "",
};

export interface ProviderEntry {
	name: string;
	provider: string;
	models: ModelConfig[];
	apiKey: string;
	baseUrl: string;
	webSearch?: {
		enabled: boolean;
		forceSearch?: boolean;
		maxKeyword?: number;
	};
}

function emptyProvider(): ProviderEntry {
	return {
		name: "",
		provider: "openai",
		models: [{ id: "", reasoningEffort: "auto" }],
		apiKey: "",
		baseUrl: "",
		webSearch: undefined,
	};
}

interface ProviderFormProps {
	values: {
		defaultProvider: string;
		providers: ProviderEntry[];
	};
	onChange: (values: ProviderFormProps["values"]) => void;
}

export function ProviderForm({ values, onChange }: ProviderFormProps) {
	const { t } = useLocale();
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [editingEntry, setEditingEntry] = useState<ProviderEntry>(emptyProvider());
	const [selectedModelIndex, setSelectedModelIndex] = useState(0);
	const [isNew, setIsNew] = useState(false);
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<{
		connected: boolean;
		error?: string;
	} | null>(null);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [providerOptionsText, setProviderOptionsText] = useState("");
	const [providerOptionsError, setProviderOptionsError] = useState<string | null>(null);

	const resetAdvancedState = (entry: ProviderEntry, modelIdx: number) => {
		const opts = entry.models[modelIdx]?.providerOptions;
		setProviderOptionsText(opts && Object.keys(opts).length > 0 ? JSON.stringify(opts, null, 2) : "");
		setProviderOptionsError(null);
		setAdvancedOpen(false);
	};

	const openAdd = () => {
		const entry = emptyProvider();
		setEditingEntry(entry);
		setEditingIndex(null);
		setSelectedModelIndex(0);
		setIsNew(true);
		setTestResult(null);
		resetAdvancedState(entry, 0);
	};

	const openEdit = (index: number) => {
		const entry = {
			...values.providers[index],
			models: values.providers[index].models.map((m) => ({ ...m })),
		};
		setEditingEntry(entry);
		setEditingIndex(index);
		setSelectedModelIndex(0);
		setIsNew(false);
		setTestResult(null);
		resetAdvancedState(entry, 0);
	};

	const saveEntry = (entry: ProviderEntry) => {
		const keys = entry.models.map((m) => m.alias ?? m.id);
		if (new Set(keys).size !== keys.length) {
			alert(t("provider.model.duplicateAlias"));
			return;
		}
		const next = { ...values };
		if (isNew) {
			next.providers = [...next.providers, entry];
			if (next.providers.length === 1) {
				next.defaultProvider = entry.name;
			}
		} else if (editingIndex !== null) {
			next.providers = next.providers.map((p, i) => (i === editingIndex ? entry : p));
			// Update defaultProvider if name changed
			if (values.providers[editingIndex].name === values.defaultProvider) {
				next.defaultProvider = entry.name;
			}
		}
		onChange(next);
		setEditingIndex(null);
		setIsNew(false);
	};

	const handleSave = () => {
		saveEntry(editingEntry);
	};

	const handleDelete = (index: number) => {
		const next = { ...values };
		const deleted = next.providers[index];
		next.providers = next.providers.filter((_, i) => i !== index);
		if (deleted.name === next.defaultProvider && next.providers.length > 0) {
			next.defaultProvider = next.providers[0].name;
		}
		onChange(next);
	};

	const setDefault = (name: string) => {
		onChange({ ...values, defaultProvider: name });
	};

	const updateEditing = (
		key: string,
		value: string | boolean | number | undefined | ProviderEntry["webSearch"],
	) => {
		const next = { ...editingEntry, [key]: value };
		if (key === "provider" && typeof value === "string" && value in PROVIDER_BASE_URLS) {
			next.baseUrl = PROVIDER_BASE_URLS[value];
		}
		setEditingEntry(next);
		setTestResult(null);
	};

	const updateModelField = (key: string, value: unknown) => {
		const nextModels = editingEntry.models.map((m, i) =>
			i === selectedModelIndex ? { ...m, [key]: value } : m,
		);
		setEditingEntry({ ...editingEntry, models: nextModels });
		setTestResult(null);
	};

	const testConnection = async () => {
		setTesting(true);
		setTestResult(null);
		try {
			const result = await api.testProvider({
				provider: editingEntry.provider,
				apiKey: editingEntry.apiKey,
				model: editingEntry.models[selectedModelIndex].id,
				baseUrl: editingEntry.baseUrl || undefined,
			});
			setTestResult(result);
		} catch {
			setTestResult({ connected: false, error: t("provider.requestFailed") });
		} finally {
			setTesting(false);
		}
	};

	const isEditing = isNew || editingIndex !== null;

	return (
		<div className="flex flex-col gap-4">
			{/* Provider list */}
			{values.providers.map((p, i) => (
				<div
					key={p.name}
					className="flex items-center justify-between p-4 rounded-lg border border-border bg-card transition-colors hover:bg-accent/30"
				>
					<div className="flex-1">
						<div className="flex items-center gap-2">
							<span className="font-medium">{p.name}</span>
							<span className="text-xs text-muted-foreground">
								{PROVIDER_TYPES.find((pt) => pt.value === p.provider)?.label ?? p.provider}
							</span>
							{p.name === values.defaultProvider && (
								<span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
									{t("provider.default")}
								</span>
							)}
						</div>
						<p className="text-sm text-muted-foreground mt-0.5">{p.models[0]?.id ?? ""}</p>
					</div>
					<div className="flex items-center gap-2">
						{p.name !== values.defaultProvider && (
							<Button variant="ghost" size="sm" onClick={() => setDefault(p.name)}>
								{t("provider.setDefault")}
							</Button>
						)}
						<Button variant="outline" size="sm" onClick={() => openEdit(i)}>
							{t("common.edit")}
						</Button>
						{values.providers.length > 1 && (
							<Button variant="outline" size="sm" onClick={() => handleDelete(i)}>
								{t("common.delete")}
							</Button>
						)}
					</div>
				</div>
			))}

			<Button variant="outline" onClick={openAdd}>
				{t("provider.addProvider")}
			</Button>

			{/* Edit dialog */}
			<Dialog
				open={isEditing}
				onOpenChange={(open) => {
					if (!open) {
						setEditingIndex(null);
						setIsNew(false);
					}
				}}
			>
				<DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
					<DialogHeader>
						<DialogTitle>
							{isNew ? t("provider.addProvider") : t("provider.editProvider")}
						</DialogTitle>
					</DialogHeader>
					<div className="flex flex-col gap-4">
						<div className="flex flex-col gap-2">
							<Label>{t("provider.name")}</Label>
							<Input
								value={editingEntry.name}
								onChange={(e) => updateEditing("name", e.target.value)}
								placeholder="my-provider"
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label>{t("provider.label")}</Label>
							<Select
								value={editingEntry.provider}
								onValueChange={(v) => updateEditing("provider", v)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PROVIDER_TYPES.map((p) => (
										<SelectItem key={p.value} value={p.value}>
											{p.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-2">
							<Label>{t("provider.apiKey")}</Label>
							<SensitiveInput
								value={editingEntry.apiKey}
								onChange={(v) => updateEditing("apiKey", v)}
								placeholder="sk-..."
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label>
							{editingEntry.provider === "openai-compatible"
								? t("provider.baseUrlRequired")
								: t("provider.baseUrl")}
						</Label>
							<Input
								value={editingEntry.baseUrl}
								onChange={(e) => updateEditing("baseUrl", e.target.value)}
								placeholder={t("provider.baseUrlPlaceholder")}
							/>
						</div>
						<div className="flex flex-col gap-3 p-3 rounded-md border border-border">
							<div className="text-sm font-medium">{t("model.section")}</div>
							<div className="space-y-2">
								<Label>{t("provider.models")}</Label>
								<div className="flex flex-wrap gap-2">
									{editingEntry.models.map((m, i) => (
										<Button
											key={i}
											type="button"
											variant={i === selectedModelIndex ? "default" : "outline"}
											size="sm"
											onClick={() => {
												setSelectedModelIndex(i);
												resetAdvancedState(editingEntry, i);
											}}
										>
											{i === 0 && "★ "}
											{m.alias ?? m.id ?? t("provider.model.untitled")}
										</Button>
									))}
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() => {
											setEditingEntry({
												...editingEntry,
												models: [...editingEntry.models, { id: "", reasoningEffort: "auto" }],
											});
											setSelectedModelIndex(editingEntry.models.length);
										}}
									>
										+ {t("provider.model.add")}
									</Button>
									{editingEntry.models.length > 1 && selectedModelIndex !== 0 && (
										<Button
											type="button"
											size="sm"
											variant="ghost"
											onClick={() => {
												const nextModels = [...editingEntry.models];
												const [picked] = nextModels.splice(selectedModelIndex, 1);
												nextModels.unshift(picked);
												saveEntry({ ...editingEntry, models: nextModels });
											}}
										>
											★ {t("provider.model.setDefault")}
										</Button>
									)}
									{editingEntry.models.length > 1 && (
										<Button
											type="button"
											size="sm"
											variant="ghost"
											onClick={() => {
												const nextModels = editingEntry.models.filter((_, i) => i !== selectedModelIndex);
												setEditingEntry({ ...editingEntry, models: nextModels });
												setSelectedModelIndex(Math.max(0, selectedModelIndex - 1));
											}}
										>
											− {t("provider.model.remove")}
										</Button>
									)}
								</div>
							</div>
							<div className="flex flex-col gap-2">
								<Label>{t("model.id")}</Label>
								<Input
									value={editingEntry.models[selectedModelIndex].id}
									onChange={(e) => updateModelField("id", e.target.value)}
									placeholder="gpt-4o"
								/>
							</div>
							<div className="space-y-1.5">
								<Label>{t("provider.model.alias")}</Label>
								<Input
									value={editingEntry.models[selectedModelIndex].alias ?? ""}
									onChange={(e) => updateModelField("alias", e.target.value || undefined)}
									placeholder={editingEntry.models[selectedModelIndex].id}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<Label>{t("model.reasoningEffort")}</Label>
								<Select
									value={editingEntry.models[selectedModelIndex].reasoningEffort ?? "auto"}
									onValueChange={(v) =>
										updateModelField("reasoningEffort", v as ReasoningEffort)
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="off">{t("model.reasoningEffort.off")}</SelectItem>
										<SelectItem value="auto">{t("model.reasoningEffort.auto")}</SelectItem>
										<SelectItem value="minimal">{t("model.reasoningEffort.minimal")}</SelectItem>
										<SelectItem value="low">{t("model.reasoningEffort.low")}</SelectItem>
										<SelectItem value="medium">{t("model.reasoningEffort.medium")}</SelectItem>
										<SelectItem value="high">{t("model.reasoningEffort.high")}</SelectItem>
										<SelectItem value="max">{t("model.reasoningEffort.max")}</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="flex flex-col gap-2">
								<div className="flex items-center justify-between">
									<Label>{t("model.temperature")}</Label>
									<span className="text-sm text-muted-foreground">
										{editingEntry.models[selectedModelIndex].temperature ?? t("advanced.default")}
									</span>
								</div>
								<Slider
									value={[editingEntry.models[selectedModelIndex].temperature ?? 1]}
									onValueChange={([v]) => updateModelField("temperature", v)}
									min={0}
									max={2}
									step={0.1}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<div className="flex items-center justify-between">
									<Label>{t("model.topP")}</Label>
									<span className="text-sm text-muted-foreground">
										{editingEntry.models[selectedModelIndex].topP ?? t("advanced.default")}
									</span>
								</div>
								<Slider
									value={[editingEntry.models[selectedModelIndex].topP ?? 1]}
									onValueChange={([v]) => updateModelField("topP", v)}
									min={0}
									max={1}
									step={0.05}
								/>
							</div>
							<div className="flex flex-col gap-2">
								<button
									type="button"
									className="text-sm text-left text-muted-foreground hover:text-foreground"
									onClick={() => setAdvancedOpen((v) => !v)}
								>
									{advancedOpen ? "▾" : "▸"} {t("model.providerOptions")}
								</button>
								{advancedOpen && (
									<div className="flex flex-col gap-1">
										<textarea
											className="min-h-[120px] rounded-md border border-border bg-background p-2 font-mono text-xs"
											value={providerOptionsText}
											onChange={(e) => {
												setProviderOptionsText(e.target.value);
												setProviderOptionsError(null);
											}}
											onBlur={() => {
												const text = providerOptionsText.trim();
												if (text === "") {
													updateModelField("providerOptions", undefined);
													setProviderOptionsError(null);
													return;
												}
												try {
													const parsed = JSON.parse(text);
													if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
														updateModelField("providerOptions", parsed as Record<string, unknown>);
														setProviderOptionsError(null);
													} else {
														setProviderOptionsError("Must be a JSON object");
													}
												} catch (err) {
													setProviderOptionsError(
														err instanceof Error ? err.message : "Invalid JSON",
													);
												}
											}}
											placeholder='{"openai": {"reasoningSummary": "auto"}}'
										/>
										<p className="text-xs text-muted-foreground">
											{t("model.providerOptions.hint")}
										</p>
										{providerOptionsError && (
											<p className="text-xs text-red-500">{providerOptionsError}</p>
										)}
									</div>
								)}
							</div>
						</div>
						{editingEntry.provider === "xiaomi-mimo" &&
							!editingEntry.baseUrl.includes("token-plan") && (
							<div className="flex flex-col gap-3 p-3 rounded-md border border-border">
								<div className="flex items-center justify-between">
									<div>
										<Label>{t("advanced.webSearch")}</Label>
										<p className="text-sm text-muted-foreground">
											{t("advanced.webSearchDescription")}
										</p>
									</div>
									<Switch
										checked={editingEntry.webSearch?.enabled ?? false}
										onCheckedChange={(v) =>
											updateEditing("webSearch", {
												...(editingEntry.webSearch ?? {}),
												enabled: v,
											})
										}
									/>
								</div>
								{editingEntry.webSearch?.enabled && (
									<>
										<div className="flex items-center justify-between">
											<div>
												<Label>{t("advanced.webSearchForce")}</Label>
												<p className="text-sm text-muted-foreground">
													{t("advanced.webSearchForceDescription")}
												</p>
											</div>
											<Switch
												checked={editingEntry.webSearch?.forceSearch ?? false}
												onCheckedChange={(v) =>
													updateEditing("webSearch", {
														...(editingEntry.webSearch ?? { enabled: true }),
														forceSearch: v,
													})
												}
											/>
										</div>
										<div className="flex flex-col gap-2">
											<Label>{t("advanced.webSearchMaxKeyword")}</Label>
											<Input
												type="number"
												min={1}
												value={editingEntry.webSearch?.maxKeyword ?? ""}
												onChange={(e) => {
													const raw = e.target.value;
													const n = raw === "" ? undefined : Number.parseInt(raw, 10);
													updateEditing("webSearch", {
														...(editingEntry.webSearch ?? { enabled: true }),
														maxKeyword: Number.isFinite(n as number) ? n : undefined,
													});
												}}
												placeholder="3"
											/>
										</div>
									</>
								)}
							</div>
						)}
						<div className="flex items-center gap-3">
							<Button
								type="button"
								variant="outline"
								onClick={testConnection}
								disabled={testing || !editingEntry.apiKey || !editingEntry.models[selectedModelIndex]?.id}
							>
								{testing ? t("provider.testing") : t("provider.testConnection")}
							</Button>
							{testResult && (
								<span
									className={`text-sm ${testResult.connected ? "text-green-500" : "text-red-500"}`}
								>
									{testResult.connected ? t("provider.connected") : (testResult.error ?? "Failed")}
								</span>
							)}
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setEditingIndex(null);
								setIsNew(false);
							}}
						>
							{t("common.cancel")}
						</Button>
						<Button
							onClick={handleSave}
							disabled={
								!editingEntry.name ||
								!editingEntry.models[0]?.id ||
								(editingEntry.provider === "openai-compatible" && !editingEntry.baseUrl)
							}
						>
							{t("common.save")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
