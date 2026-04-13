import type { ChannelToolProvider } from "@openmantis/common/types/tools";
import { createQQTools } from "./tools";

export { QQChannel } from "./channel";
export type { ChannelBindingsLike, CommandRouterLike } from "./channel";
export { createQQTools } from "./tools";

export const qqToolsProvider: ChannelToolProvider = (ctx, config) => {
	const cfg = config as { qq?: { appId?: string; clientSecret?: string; sandbox?: boolean } };
	if (!cfg.qq?.appId || !cfg.qq?.clientSecret) return {};
	const msgId = ctx.metadata?.qqMsgId as string | undefined;
	return createQQTools(
		{ appId: cfg.qq.appId, clientSecret: cfg.qq.clientSecret, sandbox: cfg.qq.sandbox },
		ctx.channelId,
		msgId,
	);
};
