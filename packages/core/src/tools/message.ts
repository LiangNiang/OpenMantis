import { createLogger } from "@openmantis/common/logger";
import { tool } from "ai";
import { z } from "zod";
import { getGateway } from "../context/gateway-context";

const logger = createLogger("core/tools");

export function createMessageTools(): Record<string, any> {
	return {
		send_message: tool({
			description:
				"向指定渠道的指定对话发送一条文本消息。用于跨渠道通知场景，例如将结果推送到另一个群聊。",
			inputSchema: z.object({
				channelType: z.string().describe("目标渠道类型，如 feishu:main, wecom, qq"),
				channelId: z.string().describe("目标渠道 ID"),
				content: z.string().describe("要发送的文本内容"),
			}),
			execute: async (input) => {
				logger.debug("[tool:message] send_message called", input);

				const gateway = getGateway();
				if (!gateway) {
					return "发送失败: gateway 未初始化";
				}

				try {
					await gateway.pushMessage(input.channelType, input.channelId, input.content);
					return `已发送消息到 ${input.channelType}/${input.channelId}`;
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					logger.error("[tool:message] send_message failed:", err);
					return `发送失败: ${message}`;
				}
			},
		}),
	};
}
