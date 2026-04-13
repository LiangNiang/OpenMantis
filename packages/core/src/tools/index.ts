import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { OpenMantisConfig } from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import type { Tool } from "ai";
import { getGateway } from "../context/gateway-context";
import { getSchedulerService } from "../context/scheduler-context";

const logger = createLogger("core/tools");

import { BASH_TOOL_GUIDE, createBashTools } from "./bash";
import { createExaTools } from "./exa";
import { createFileTools, FILE_TOOL_GUIDE } from "./file";
import { createMemoryTools, MEMORY_TOOL_GUIDE } from "./memory";
import { createMessageTools } from "./message";
import { createRssTools } from "./rss";
import { createScheduleTools, SCHEDULE_TOOL_GUIDE } from "./schedule";
import { createSearchTools, SEARCH_TOOL_GUIDE } from "./search";
import { createSkillTools, SKILLS_TOOL_GUIDE } from "./skills";
import { createTavilyTools, TAVILY_TOOL_GUIDE } from "./tavily";
import { createTtsTools } from "./tts";
import { createWhisperTools } from "./whisper";

export interface ResolvedTools {
	tools: Record<string, Tool>;
	skillInstructions: string;
	toolGuides: string;
}

// Note: this is the in-core specialized ChannelContext. The generic version
// lives in @openmantis/common/types/tools and is used by external channel packages.
export interface ChannelContext {
	channelType: string;
	channelId: string;
	routeId?: string;
	model?: LanguageModelV3;
	isScheduledExecution?: boolean;
	metadata?: Record<string, unknown>;
}

export interface ChannelToolResult {
	tools: Record<string, Tool>;
	guide?: string;
}

export type ChannelToolProvider = (
	ctx: ChannelContext,
	config: OpenMantisConfig,
) => Record<string, Tool> | ChannelToolResult;

export type ChannelToolProviders = Record<string, ChannelToolProvider>;

const ALL_TOOL_GROUPS = [
	"bash",
	"file",
	"search",
	"skills",
	"tavily",
	"exa",
	"schedule",
	"rss",
	"whisper",
	"tts",
	"memory",
] as const;

export async function resolveTools(
	excludeGroups: string[],
	config?: OpenMantisConfig,
	channelCtx?: ChannelContext,
	channelToolProviders?: ChannelToolProviders,
): Promise<ResolvedTools> {
	const tools: Record<string, Tool> = {};
	let skillInstructions = "";
	const guides: string[] = [];
	const groups = ALL_TOOL_GROUPS.filter((g) => !excludeGroups.includes(g));

	for (const group of groups) {
		switch (group) {
			case "bash": {
				const bashTools = createBashTools(config);
				Object.assign(tools, bashTools);
				guides.push(BASH_TOOL_GUIDE);
				break;
			}
			case "file": {
				const fileTools = createFileTools();
				Object.assign(tools, fileTools);
				guides.push(FILE_TOOL_GUIDE);
				break;
			}
			case "skills": {
				const { tools: skillTools, instructions } = await createSkillTools(config);
				Object.assign(tools, skillTools);
				skillInstructions = instructions;
				if (Object.keys(skillTools).length > 0) guides.push(SKILLS_TOOL_GUIDE);
				break;
			}
			case "tavily": {
				if (!config?.tavily?.apiKey) {
					logger.warn("[resolveTools] tavily tool group requires tavily.apiKey config");
					break;
				}
				Object.assign(tools, createTavilyTools(config.tavily.apiKey));
				guides.push(TAVILY_TOOL_GUIDE);
				break;
			}
			case "exa": {
				if (!config?.exa?.apiKey) {
					logger.warn("[resolveTools] exa tool group requires exa.apiKey config");
					break;
				}
				Object.assign(tools, createExaTools(config.exa.apiKey));
				break;
			}
			case "rss": {
				Object.assign(tools, createRssTools());
				break;
			}
			case "schedule": {
				if (channelCtx?.isScheduledExecution) {
					logger.debug("[resolveTools] skipping schedule tools for scheduled execution");
					break;
				}
				const scheduler = getSchedulerService();
				if (!scheduler) {
					logger.warn("[resolveTools] schedule tool requires scheduler context");
					break;
				}
				const scheduleTools = createScheduleTools({
					scheduler,
					channelType: channelCtx?.channelType ?? "unknown",
					channelId: channelCtx?.channelId ?? "unknown",
				});
				Object.assign(tools, scheduleTools);
				guides.push(SCHEDULE_TOOL_GUIDE);
				break;
			}
			case "search": {
				Object.assign(tools, createSearchTools(process.cwd()));
				guides.push(SEARCH_TOOL_GUIDE);
				break;
			}
			case "whisper": {
				if (!config?.whisper?.apiKey) {
					logger.warn("[resolveTools] whisper tool group requires whisper.apiKey config");
					break;
				}
				Object.assign(tools, createWhisperTools(config));
				break;
			}
			case "tts": {
				if (!config?.xiaomiTts?.enabled) break;
				Object.assign(tools, createTtsTools(config, channelCtx));
				break;
			}
			case "memory": {
				if (config?.memory?.enabled === false) break;
				if (!channelCtx) break;
				const memTools = createMemoryTools({
					channelId: channelCtx.channelId,
					routeId: channelCtx.routeId ?? "unknown",
					model: channelCtx.model,
				});
				Object.assign(tools, memTools);
				guides.push(MEMORY_TOOL_GUIDE);
				break;
			}
		}
	}

	// 注入渠道特定工具（由调用方通过 channelToolProviders 提供）
	if (channelCtx && channelToolProviders && config) {
		const baseType = channelCtx.channelType.split(":")[0]!;
		const provider = channelToolProviders[baseType] ?? channelToolProviders[channelCtx.channelType];
		if (provider) {
			const result = provider(channelCtx, config);
			const isStructured =
				result != null &&
				"tools" in result &&
				typeof result.tools === "object" &&
				!("execute" in result.tools);
			if (isStructured) {
				const channelResult = result as ChannelToolResult;
				Object.assign(tools, channelResult.tools);
				if (channelResult.guide) guides.push(channelResult.guide);
			} else {
				Object.assign(tools, result as Record<string, Tool>);
			}
		}
	}

	// 始终注入消息发送工具（当 gateway 上下文可用时）
	const gateway = getGateway();
	if (gateway) {
		Object.assign(tools, createMessageTools());
	}

	return { tools, skillInstructions, toolGuides: guides.join("\n") };
}

export { createBashTools } from "./bash";
export { createExaTools } from "./exa";
export { createFileTools } from "./file";
export { createMemoryTools } from "./memory";
export { createRssTools } from "./rss";
export { createScheduleTools } from "./schedule";
export { createSearchTools } from "./search";
export { createSkillTools } from "./skills";
export { createTavilyTools } from "./tavily";
export { createTtsTools } from "./tts";
export { createWhisperTools } from "./whisper";
