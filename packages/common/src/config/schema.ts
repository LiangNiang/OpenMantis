import { z } from "zod";

const channelTtsSchema = z.object({
	enabled: z.boolean().default(false),
	provider: z.enum(["xiaomi-mimo"]).default("xiaomi-mimo"),
});

const feishuConfigSchema = z.object({
	name: z.string().regex(/^[a-z0-9-]+$/, "name must be lowercase alphanumeric with hyphens"),
	appId: z.string(),
	appSecret: z.string(),
	provider: z.string().optional(),
	tts: channelTtsSchema.optional(),
});

const wecomConfigSchema = z.object({
	botId: z.string(),
	secret: z.string(),
	provider: z.string().optional(),
	tts: channelTtsSchema.optional(),
});

const qqConfigSchema = z.object({
	appId: z.string(),
	clientSecret: z.string(),
	sandbox: z.boolean().default(false),
	provider: z.string().optional(),
});

const tavilyConfigSchema = z.object({
	apiKey: z.string(),
});

const exaConfigSchema = z.object({
	apiKey: z.string().optional(),
});

const wecomDocConfigSchema = z.object({
	mcpUrl: z.string(),
});

const volcengineConfigSchema = z.object({
	arkApiKey: z.string().optional(),
});

const whisperConfigSchema = z.object({
	apiKey: z.string().optional(),
	baseUrl: z.string().optional(),
});

const xiaomiTtsConfigSchema = z.object({
	enabled: z.boolean().default(false),
	apiKey: z.string().optional(),
	baseUrl: z.string().optional(),
	voice: z.string().default("mimo_default"),
	style: z.string().optional(),
	stream: z.boolean().default(true),
});

const bashConfigSchema = z.object({
	timeout: z.number().default(600_000),
	maxOutputLength: z.number().default(30_000),
	silenceTimeout: z.number().default(10_000),
	callTimeout: z.number().default(90_000),
});

const browserCdpConfigSchema = z
	.object({
		port: z.number().int().positive().max(65535).optional(),
		autoConnect: z.boolean().optional(),
	})
	.refine((v) => !(v.port !== undefined && v.autoConnect !== undefined), {
		message: "browser.cdp.port and browser.cdp.autoConnect are mutually exclusive",
		path: ["autoConnect"],
	});

const browserConfigSchema = z.object({
	enabled: z.boolean().default(false),
	binPath: z.string().default("agent-browser"),
	cdp: browserCdpConfigSchema.optional(),
	maxOutputLength: z.number().int().positive().optional(),
});

export function isBrowserCdpActive(config: {
	browser?: { enabled?: boolean; cdp?: { port?: number; autoConnect?: boolean } };
}): boolean {
	const b = config.browser;
	if (!b?.enabled || !b.cdp) return false;
	return typeof b.cdp.port === "number" || b.cdp.autoConnect === true;
}

const skillsConfigSchema = z.object({
	directory: z.string().default("./skills"),
	builtinEnabled: z.boolean().default(true),
});

const webConfigSchema = z.object({
	port: z.number().default(7777),
	host: z.string().default("127.0.0.1"),
	authToken: z.string().optional(),
});

export const reasoningEffortSchema = z.enum([
	"off",
	"auto",
	"minimal",
	"low",
	"medium",
	"high",
	"max",
]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const modelConfigSchema = z.object({
	alias: z.string().optional(),
	id: z.string(),
	reasoningEffort: reasoningEffortSchema.default("auto"),
	temperature: z.number().optional(),
	topP: z.number().optional(),
	providerOptions: z.record(z.string(), z.unknown()).optional(),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

export const providerConfigSchema = z
	.object({
		name: z.string(),
		provider: z.string().default("openai"),
		models: z.array(modelConfigSchema).min(1),
		apiKey: z.string().optional(),
		baseUrl: z.string().optional().default(""),
		webSearch: z
			.object({
				enabled: z.boolean().default(false),
				forceSearch: z.boolean().optional(),
				maxKeyword: z.number().int().positive().optional(),
			})
			.optional(),
	})
	.refine(
		(p) => {
			const keys = p.models.map((m) => m.alias ?? m.id);
			return new Set(keys).size === keys.length;
		},
		{
			message: "Model aliases (or ids when alias absent) must be unique within a provider",
			path: ["models"],
		},
	)
	.refine(
		(p) => p.provider !== "openai-compatible" || (p.baseUrl != null && p.baseUrl !== ""),
		{
			message: "baseUrl is required for openai-compatible provider",
			path: ["baseUrl"],
		},
	);

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

const memoryConfigSchema = z.object({
	enabled: z.boolean().default(true),
	autoExtract: z.boolean().default(true),
	autoExtractMinMessages: z.number().int().positive().default(3),
});

export const configSchema = z
	.object({
		defaultProvider: z.string().default("default"),
		providers: z
			.array(providerConfigSchema)
			.min(1)
			.default([
				{
					name: "default",
					provider: "openai",
					models: [{ id: "gpt-4o", reasoningEffort: "auto" }],
					baseUrl: "",
				},
			]),
		systemPrompt: z.string().default(""),
		maxToolRoundtrips: z.number().default(50),
		channels: z.array(z.string()).default([]),
		excludeTools: z.array(z.string()).default([]),
		feishu: z.array(feishuConfigSchema).optional(),
		wecom: wecomConfigSchema.optional(),
		qq: qqConfigSchema.optional(),
		tavily: tavilyConfigSchema.optional(),
		exa: exaConfigSchema.optional(),
wecomDoc: wecomDocConfigSchema.optional(),
		volcengine: volcengineConfigSchema.optional(),
		whisper: whisperConfigSchema.optional(),
		xiaomiTts: xiaomiTtsConfigSchema.optional(),
		bash: bashConfigSchema.optional(),
		browser: browserConfigSchema.optional(),
		skills: skillsConfigSchema.optional(),
		web: webConfigSchema.optional(),
		memory: memoryConfigSchema.optional(),
	})
	.refine((c) => new Set(c.providers.map((p) => p.name)).size === c.providers.length, {
		message: "Provider names must be unique",
	})
	.refine((c) => c.providers.some((p) => p.name === c.defaultProvider), {
		message: "defaultProvider must match a provider name",
	});

export type OpenMantisConfig = z.infer<typeof configSchema>;

/** Resolve a provider config by name. Throws if not found. */
export function resolveProvider(config: OpenMantisConfig, name?: string): ProviderConfig {
	const providerName = name ?? config.defaultProvider;
	const found = config.providers.find((p) => p.name === providerName);
	if (!found) {
		const available = config.providers.map((p) => p.name).join(", ");
		throw new Error(`Provider "${providerName}" not found. Available: ${available}`);
	}
	return found;
}
