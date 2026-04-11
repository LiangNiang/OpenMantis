import type { ChannelToolProvider } from "@openmantis/common/types/tools";
import { createQQTools } from "./tools";

export { QQChannel } from "./channel";
export type { ChannelBindingsLike, CommandRouterLike } from "./channel";
export { createQQTools } from "./tools";

export const qqToolsProvider: ChannelToolProvider = (ctx, config) => {
	const cfg = config as { qq?: { appId?: string; clientSecret?: string } };
	if (!cfg.qq?.appId || !cfg.qq?.clientSecret) return {};
	return createQQTools(
		{ appId: cfg.qq.appId, clientSecret: cfg.qq.clientSecret },
		ctx.channelId,
	);
};
