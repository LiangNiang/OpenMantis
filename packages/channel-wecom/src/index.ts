import type { ChannelToolProvider } from "@openmantis/common/types/tools";
import { getWecomClient } from "./context";
import { createWecomDocTools, createWecomFileTools } from "./tools";

export { WeComChannel } from "./channel";
export type { ChannelBindingsLike, CommandRouterLike } from "./channel";
export { getWecomClient, setWecomClient } from "./context";
export { createWecomDocTools, createWecomFileTools } from "./tools";
export type { WeComConfig } from "./types";

export const wecomToolsProvider: ChannelToolProvider = (ctx, config) => {
	const cfg = config as { wecomDoc?: { mcpUrl?: string } };
	const tools: Record<string, import("ai").Tool> = {};
	if (cfg.wecomDoc?.mcpUrl) {
		Object.assign(tools, createWecomDocTools(cfg.wecomDoc.mcpUrl));
	}
	const client = getWecomClient();
	if (client) {
		const chatId = ctx.channelId.slice("wecom-".length);
		Object.assign(tools, createWecomFileTools(client, chatId));
	}
	return tools;
};
