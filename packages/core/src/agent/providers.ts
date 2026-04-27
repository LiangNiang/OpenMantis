import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ModelConfig, ProviderConfig } from "@openmantis/common/config/schema";
import { type LanguageModelMiddleware, wrapLanguageModel } from "ai";

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
			// DeepSeek-V4-Pro thinking mode requires reasoning_content from prior
			// assistant turns to be replayed in subsequent requests, but
			// @ai-sdk/deepseek 2.0.29 strips it (convert-to-deepseek-chat-messages
			// drops reasoning whose index <= lastUserMessageIndex). Capture the
			// reasoning text per assistant index from the V3 prompt, then re-inject
			// it into the outgoing JSON body. Remove this once the SDK is fixed.
			let reasoningByAssistantIndex: string[] = [];

			const captureReasoning: LanguageModelMiddleware = {
				specificationVersion: "v3",
				transformParams: async ({ params }) => {
					reasoningByAssistantIndex = [];
					for (const m of params.prompt) {
						if (m.role !== "assistant") continue;
						const text = m.content
							.filter((c): c is { type: "reasoning"; text: string } => c.type === "reasoning")
							.map((c) => c.text)
							.join("");
						reasoningByAssistantIndex.push(text);
					}
					return params;
				},
			};

			const injectReasoning = (async (input: RequestInfo | URL, init?: RequestInit) => {
				if (init?.body && typeof init.body === "string") {
					try {
						const body = JSON.parse(init.body);
						if (Array.isArray(body.messages)) {
							let assistantSeen = 0;
							for (const m of body.messages) {
								if (m.role !== "assistant") continue;
								const r = reasoningByAssistantIndex[assistantSeen];
								if (r && !m.reasoning_content) {
									m.reasoning_content = r;
								}
								assistantSeen += 1;
							}
							init = { ...init, body: JSON.stringify(body) };
						}
					} catch {
						// Non-JSON body, pass through unchanged
					}
				}
				return fetch(input as RequestInfo, init);
			}) as typeof fetch;

			const deepseek = createDeepSeek({
				apiKey: providerConfig.apiKey,
				baseURL: providerConfig.baseUrl || undefined,
				fetch: injectReasoning,
			});
			return wrapLanguageModel({
				model: deepseek(model),
				middleware: captureReasoning,
			});
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
