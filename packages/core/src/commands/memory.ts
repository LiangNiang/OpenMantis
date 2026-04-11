import { createLogger } from "@openmantis/common/logger";
import { memoryStore } from "../tools/memory";
import type { CommandContext, CommandDefinition, CommandResult } from "./types";

const logger = createLogger("core/commands");

export const rememberCommand: CommandDefinition = {
	name: "remember",
	description: "Save something to core memory",
	usage: "/remember <content>",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		if (!ctx.rawArgs.trim()) {
			return { type: "display", text: "Usage: /remember <content>" };
		}

		try {
			await memoryStore.saveToCore(ctx.channelId, "General", ctx.rawArgs.trim());
			return { type: "display", text: `已记住：${ctx.rawArgs.trim()}` };
		} catch (err) {
			logger.error("[command] /remember failed:", err);
			return { type: "display", text: "保存记忆失败" };
		}
	},
};

export const forgetCommand: CommandDefinition = {
	name: "forget",
	description: "Remove matching entries from core memory",
	usage: "/forget <keyword>",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		if (!ctx.rawArgs.trim()) {
			return { type: "display", text: "Usage: /forget <keyword>" };
		}

		try {
			const removed = await memoryStore.removeFromCore(ctx.channelId, ctx.rawArgs.trim());
			if (removed === 0) {
				return {
					type: "display",
					text: `未找到包含"${ctx.rawArgs.trim()}"的记忆`,
				};
			}
			return { type: "display", text: `已删除 ${removed} 条记忆` };
		} catch (err) {
			logger.error("[command] /forget failed:", err);
			return { type: "display", text: "删除记忆失败" };
		}
	},
};

export const memoriesCommand: CommandDefinition = {
	name: "memories",
	description: "Show current core memories",
	usage: "/memories",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		try {
			const content = await memoryStore.loadCore(ctx.channelId);
			if (!content.trim()) {
				return { type: "display", text: "暂无核心记忆" };
			}
			return { type: "display", text: `核心记忆\n\n${content}` };
		} catch (err) {
			logger.error("[command] /memories failed:", err);
			return { type: "display", text: "读取记忆失败" };
		}
	},
};
