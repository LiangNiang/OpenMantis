import {
	type ModelConfig,
	type OpenMantisConfig,
	resolveProvider,
} from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import { MESSAGE_SOURCE } from "@openmantis/common/types/channels";
import { type ModelMessage, stepCountIs, type Tool, ToolLoopAgent, wrapLanguageModel } from "ai";
import { type ChannelToolProviders, resolveTools } from "../tools";

const logger = createLogger("core/agent");

import { memoriesScopeDir } from "@openmantis/common/paths";
import { readIndexRaw } from "../tools/memory/index-store";
import { buildStructuredPrompt } from "./prompts";
import { createLanguageModel } from "./providers";
import { resolveThinkingOptions } from "./thinking";

export interface CreateAgentOptions {
	provider?: string;
	messages?: ModelMessage[];
	channelType?: string;
	channelId?: string;
	routeId?: string;
	metadata?: Record<string, unknown>;
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

		const isScheduledExecution = options?.metadata?.source === MESSAGE_SOURCE.SCHEDULER;

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
						isScheduledExecution,
						metadata: options.metadata,
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

		// Inject MEMORY.md indices (global + channel) into system prompt
		// Gate on memory config / excludeTools so prompt stays consistent with tool availability.
		const memoryEnabled =
			this.config.memory?.enabled !== false && !this.config.excludeTools.includes("memory");
		if (memoryEnabled) {
			try {
				const globalIndex = await readIndexRaw("global");
				if (globalIndex) {
					const globalDir = memoriesScopeDir("global");
					instructions += `\n\n## Global Memory (cross-channel)\nFiles live under \`${globalDir}/\`. Read with absolute paths (prepend the base dir to each entry's link).\n${globalIndex}`;
				}
				if (options?.channelId) {
					const channelIndex = await readIndexRaw("channel", options.channelId);
					if (channelIndex) {
						const channelDir = memoriesScopeDir("channel", options.channelId);
						instructions += `\n\n## Channel Memory (${options.channelId})\nFiles live under \`${channelDir}/\`. Read with absolute paths (prepend the base dir to each entry's link).\n${channelIndex}`;
					}
				}
			} catch (err) {
				logger.warn("[agent] failed to load memory indices, skipping:", err);
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
