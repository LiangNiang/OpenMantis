import type { Tool } from "ai";

export interface ChannelContext {
	channelType: string;
	channelId: string;
	routeId?: string;
	model?: unknown; // LanguageModelV3 in core; contracts stays SDK-agnostic
}

export interface ChannelToolResult {
	tools: Record<string, Tool>;
	guide?: string;
}

export type ChannelToolProvider = (
	ctx: ChannelContext,
	config: unknown,
) => Record<string, Tool> | ChannelToolResult;

export type ChannelToolProviders = Record<string, ChannelToolProvider>;
