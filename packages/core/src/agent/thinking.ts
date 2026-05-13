import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { ModelConfig, ProviderConfig } from "@openmantis/common/config/schema";
import { extractReasoningMiddleware, type LanguageModelMiddleware } from "ai";

export interface ThinkingOptions {
	providerOptions?: ProviderOptions;
	middleware?: LanguageModelMiddleware;
}

/**
 * Translate the unified reasoningEffort enum into each provider's native
 * thinking configuration. See docs/superpowers/specs/2026-04-08-provider-
 * thinking-config-redesign-design.md for the full mapping table.
 */
export function resolveThinkingOptions(
	providerConfig: ProviderConfig,
	modelConfig: ModelConfig,
): ThinkingOptions {
	const effort = modelConfig.reasoningEffort;

	switch (providerConfig.provider) {
		case "openai": {
			if (effort === "off") {
				return { providerOptions: { openai: { reasoningEffort: "minimal" } } };
			}
			if (effort === "auto") return {};
			// "max" → "high" degradation; everything else passes through.
			const mapped = effort === "max" ? "high" : effort;
			return { providerOptions: { openai: { reasoningEffort: mapped } } };
		}

		case "anthropic": {
			if (effort === "off") {
				return { providerOptions: { anthropic: { thinking: { type: "disabled" } } } };
			}
			if (effort === "auto") return {};
			// "minimal" → "low" degradation; "max" passes through (Anthropic 4.6 native).
			const adaptiveEffort = effort === "minimal" ? "low" : effort;
			return {
				providerOptions: {
					anthropic: {
						thinking: { type: "adaptive" },
						output_config: { effort: adaptiveEffort },
					},
				},
			};
		}

		case "bytedance": {
			// No native effort support. "off" = no middleware; everything else
			// enables the reasoning extractor so <think> blocks surface.
			if (effort === "off") return {};
			return { middleware: extractReasoningMiddleware({ tagName: "think" }) };
		}

		case "xiaomi-mimo": {
			if (effort === "off") {
				return { providerOptions: { "xiaomi-mimo": { thinking: { type: "disabled" } } } };
			}
			if (effort === "auto") return {};
			return { providerOptions: { "xiaomi-mimo": { thinking: { type: "enabled" } } } };
		}

		case "deepseek": {
			if (effort === "off") {
				return { providerOptions: { deepseek: { thinking: { type: "disabled" } } } };
			}
			// `auto` returns {} so the server's default (deepseek-v4-pro on, -flash off)
			// applies. The SDK type accepts "adaptive", but neither DeepSeek's API docs
			// nor the AI SDK provider docs list it, so we don't send it.
			if (effort === "auto") return {};
			// "minimal" → "low" degradation; everything else passes through. We forward
			// the full enum even though DeepSeek's server may coerce granularity, so
			// cross-provider configs stay uniform.
			const mapped = effort === "minimal" ? "low" : effort;
			return {
				providerOptions: {
					deepseek: { thinking: { type: "enabled" }, reasoningEffort: mapped },
				},
			};
		}

		default:
			return {};
	}
}
