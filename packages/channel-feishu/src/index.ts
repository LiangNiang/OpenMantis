import type { ChannelToolProvider } from "@openmantis/common/types/tools";
import { getFeishuClient } from "./context";
import { FEISHU_TOOL_GUIDE, createFeishuTools } from "./tools";

export { buildInteractiveCard, buildReplyCard, buildStreamingCard } from "./cards";
export { FeishuChannel } from "./channel";
export type { ChannelBindingsLike, CommandRouterLike } from "./channel";
export { getBotOpenId, getFeishuClient, setBotOpenId, setFeishuClient } from "./context";
export { buildFeishuRouteId, parseFeishuContent, stripMention } from "./parser";
export { FEISHU_TOOL_GUIDE, createFeishuTools } from "./tools";
export type { ParsedAttachment, ParsedFeishuContent } from "./types";

export const feishuToolsProvider: ChannelToolProvider = (ctx) => {
	const chatId = ctx.channelId.slice(ctx.channelType.length + 1);
	const client = getFeishuClient(ctx.channelType);
	if (!client) return { tools: {} };
	return {
		tools: createFeishuTools(ctx.channelType, chatId),
		guide: FEISHU_TOOL_GUIDE,
	};
};
