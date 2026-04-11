import {
	type ModelConfig,
	type OpenMantisConfig,
	resolveProvider,
} from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import { type ModelMessage, stepCountIs, type Tool, ToolLoopAgent, wrapLanguageModel } from "ai";
import { type ChannelToolProviders, resolveTools } from "../tools";
import { memoryStore } from "../tools/memory";

const logger = createLogger("core/agent");

import { buildBrowserPromptSection } from "./browser-prompt";
import { buildStructuredPrompt } from "./prompts";
import { createLanguageModel } from "./providers";
import { resolveThinkingOptions } from "./thinking";

export interface CreateAgentOptions {
	provider?: string;
	messages?: ModelMessage[];
	channelType?: string;
	channelId?: string;
	routeId?: string;
}

export interface CreateAgentResult {
	agent: ToolLoopAgent;
}

export class AgentFactory {
	private config: OpenMantisConfig;
	private channelToolProviders?: ChannelToolProviders;

	constructor(config: OpenMantisConfig, channelToolProviders?: ChannelToolProviders) {
		this.config = config;
		this.channelToolProviders = channelToolProviders;
	}

	async create(options?: CreateAgentOptions): Promise<CreateAgentResult> {
		const providerConfig = resolveProvider(this.config, options?.provider);
		const modelConfig: ModelConfig = providerConfig.models[0]!;
		const model = await createLanguageModel(providerConfig, modelConfig);
		const thinkingOpts = resolveThinkingOptions(providerConfig, modelConfig);

		let wrappedModel = model;
		if (thinkingOpts.middleware) {
			wrappedModel = wrapLanguageModel({
				model: wrappedModel,
				middleware: thinkingOpts.middleware,
			});
		}

		const {
			tools: rawTools,
			skillInstructions,
			toolGuides,
		} = await resolveTools(
			this.config.excludeTools,
			this.config,
			options?.channelType && options?.channelId
				? {
						channelType: options.channelType,
						channelId: options.channelId,
						routeId: options.routeId,
						model,
					}
				: undefined,
			this.channelToolProviders,
		);
		const tools: Record<string, Tool> = {};
		for (const [name, tool] of Object.entries(rawTools)) {
			tools[name] = tool;
		}

		const maxSteps = this.config.maxToolRoundtrips;

		let instructions = buildStructuredPrompt(this.config, toolGuides);
		if (skillInstructions.trim()) {
			instructions += `\n\n## 可用技能\n\n${skillInstructions.trim()}`;
		}

		const browserSection = buildBrowserPromptSection(this.config, options?.routeId);
		if (browserSection) {
			instructions += `\n\n${browserSection}`;
		}

		// Inject core memory into system prompt
		if (options?.channelType && options?.channelId) {
			try {
				const coreMemory = await memoryStore.loadCore(options.channelId);
				if (coreMemory.trim()) {
					instructions += `\n\n## Memory\n你对这个用户了解如下：\n${coreMemory.trim()}`;
				}
			} catch (err) {
				logger.warn("[agent] failed to load core memory, skipping:", err);
			}
		}

		if (process.env.DEBUG_PROMPT === "true") {
			logger.debug("[agent] System prompt:", instructions);
		}

		const agent = new ToolLoopAgent({
			model: wrappedModel,
			instructions,
			tools,
			toolChoice: "auto",
			stopWhen: stepCountIs(maxSteps),
			// Provider options are dynamically merged from thinking config and model config.
			// The exact shape depends on the provider, so we use a type assertion here.
			providerOptions: {
				...(thinkingOpts.providerOptions ?? {}),
				...(modelConfig.providerOptions ?? {}),
			} as any,
			temperature: modelConfig.temperature,
			topP: modelConfig.topP,
			onStepFinish: (event) => {
				for (const tc of event.toolCalls) {
					const toolResult = event.toolResults.find((tr) => tr.toolCallId === tc.toolCallId);
					const input =
						typeof tc.input === "object" ? JSON.stringify(tc.input).slice(0, 200) : tc.input;
					const output = toolResult ? JSON.stringify(toolResult.output).slice(0, 200) : "no result";
					logger.debug(`[agent] tool:${tc.toolName} ${input} → ${output}`);
				}
			},
		});
		return { agent };
	}
}
