import type { CommandContext, CommandDefinition, CommandResult } from "./types";

export const openIdCommand: CommandDefinition = {
	name: "open-id",
	description: "Show your Feishu open_id",
	usage: "/open-id",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		if (!ctx.channelType.startsWith("feishu")) {
			return { type: "display", text: "此命令仅在飞书渠道可用" };
		}
		const openId = ctx.metadata?.senderOpenId as string | undefined;
		return {
			type: "display",
			text: openId ? `your open_id: \`${openId}\`` : "open_id 获取失败",
		};
	},
};
