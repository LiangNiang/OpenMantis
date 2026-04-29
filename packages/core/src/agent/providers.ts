import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ModelConfig, ProviderConfig } from "@openmantis/common/config/schema";

export async function createLanguageModel(
	providerConfig: ProviderConfig,
	modelConfig: ModelConfig,
): Promise<LanguageModelV3> {
	const model = modelConfig.id;
	switch (providerConfig.provider) {
		case "openai": {
			const openai = createOpenAI({
				apiKey: providerConfig.apiKey,
				baseURL: providerConfig.baseUrl || undefined,
			});
			return openai(model);
		}

		case "bytedance": {
			const bytedance = createOpenAICompatible({
				name: "bytedance",
				apiKey: providerConfig.apiKey,
				baseURL: providerConfig.baseUrl || "https://ark.cn-beijing.volces.com/api/v3",
			});
			return bytedance.chatModel(model);
		}

		case "anthropic": {
			const anthropic = createAnthropic({
				apiKey: providerConfig.apiKey,
				baseURL: providerConfig.baseUrl || undefined,
			});
			return anthropic(model);
		}

		case "deepseek": {
			const deepseek = createDeepSeek({
				apiKey: providerConfig.apiKey,
				baseURL: providerConfig.baseUrl || undefined,
			});
			return deepseek(model);
		}

		case "xiaomi-mimo": {
			const ws = providerConfig.webSearch;
			// token-plan endpoints do not support the web_search plugin; force-disable.
			const supportsWebSearch = !(providerConfig.baseUrl ?? "").includes("token-plan");
			const injectTool =
				supportsWebSearch && ws?.enabled
					? {
							type: "web_search",
							...(ws.forceSearch !== undefined && { force_search: ws.forceSearch }),
							...(ws.maxKeyword !== undefined && { max_keyword: ws.maxKeyword }),
						}
					: null;

			const mimo = createOpenAICompatible({
				name: "xiaomi-mimo",
				apiKey: providerConfig.apiKey,
				baseURL: providerConfig.baseUrl || "https://api.xiaomimimo.com/v1",
				fetch: injectTool
					? ((async (input: RequestInfo | URL, init?: RequestInit) => {
							if (init?.body && typeof init.body === "string") {
								try {
									const body = JSON.parse(init.body);
									body.tools = Array.isArray(body.tools)
										? [...body.tools, injectTool]
										: [injectTool];
									body.webSearchEnabled = true;
									init = { ...init, body: JSON.stringify(body) };
								} catch {
									// Non-JSON body, pass through unchanged
								}
							}
							return fetch(input as RequestInfo, init);
						}) as typeof fetch)
					: undefined,
			});
			return mimo.chatModel(model);
		}

		case "openai-compatible": {
			const provider = createOpenAICompatible({
				name: providerConfig.name,
				baseURL: providerConfig.baseUrl!,
				apiKey: providerConfig.apiKey,
			});
			return provider.chatModel(model);
		}

		default:
			throw new Error(`Unsupported provider: ${providerConfig.provider}`);
	}
}
