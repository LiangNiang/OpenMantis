// packages/core/src/commands/memory.ts

import { createLogger } from "@openmantis/common/logger";
import { deleteMemoryFile } from "../tools/memory/file-store";
import { findIndexEntries, readIndexRaw, removeFromIndex } from "../tools/memory/index-store";
import type { MemoryScope, MemoryType } from "../tools/memory/types";
import type { CommandContext, CommandDefinition, CommandResult } from "./types";

const logger = createLogger("core/commands");

/**
 * /remember 命令在 v2 不再直接写记忆——记忆需要 type/subject/Why/How 等结构化字段，
 * 应当由 agent 根据上下文判断后调用 save_memory 工具。
 * 这里把命令重定向为给 agent 一条提示，让 agent 帮忙决定。
 */
export const rememberCommand: CommandDefinition = {
	name: "remember",
	description: "Ask the agent to save something to memory (it picks the right type)",
	usage: "/remember <content>",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		const text = ctx.rawArgs.trim();
		if (!text) return { type: "display", text: "Usage: /remember <content>" };
		return {
			type: "display",
			text:
				`收到。请在下一轮对话直接告诉我"请记住：${text}"，我会判断 type/subject 后用 save_memory 写入。\n` +
				`（v2 起记忆需要结构化元数据，命令层不再裸写。）`,
		};
	},
};

export const forgetCommand: CommandDefinition = {
	name: "forget",
	description: "Forget memories matching keyword (across global + current channel)",
	usage: "/forget <keyword>",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		const keyword = ctx.rawArgs.trim();
		if (!keyword) return { type: "display", text: "Usage: /forget <keyword>" };

		try {
			const scopes: Array<{ scope: MemoryScope; channel?: string }> = [
				{ scope: "global" },
				{ scope: "channel", channel: ctx.channelId },
			];
			type Hit = {
				scope: MemoryScope;
				channel?: string;
				name: string;
				description: string;
				indexPath: string;
			};
			const hits: Hit[] = [];
			for (const s of scopes) {
				const found = await findIndexEntries({
					scope: s.scope,
					channelId: s.channel,
					keyword,
				});
				for (const f of found) {
					hits.push({
						scope: s.scope,
						channel: s.channel,
						name: f.name,
						description: f.description,
						indexPath: f.indexPath,
					});
				}
			}

			if (hits.length === 0) {
				return { type: "display", text: `未找到匹配 "${keyword}" 的记忆` };
			}
			if (hits.length > 1) {
				const list = hits
					.map((h, i) => `${i + 1}. [${h.scope}] ${h.name} — ${h.description}`)
					.join("\n");
				return {
					type: "display",
					text: `匹配多条，请用更具体的关键词：\n${list}`,
				};
			}

			const h = hits[0]!;
			const [type, filename] = h.indexPath.split("/") as [MemoryType, string];
			await deleteMemoryFile({ scope: h.scope, channelId: h.channel, type, filename });
			await removeFromIndex({ scope: h.scope, channelId: h.channel, indexPath: h.indexPath });
			return { type: "display", text: `已删除 [${h.scope}] ${h.name}` };
		} catch (err) {
			logger.error("[command] /forget failed:", err);
			return { type: "display", text: "删除记忆失败" };
		}
	},
};

export const memoriesCommand: CommandDefinition = {
	name: "memories",
	description: "Show memory indices (global + current channel)",
	usage: "/memories",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		try {
			const globalRaw = await readIndexRaw("global");
			const channelRaw = await readIndexRaw("channel", ctx.channelId);
			const sections: string[] = [];
			if (globalRaw) sections.push(`【Global】\n${globalRaw}`);
			if (channelRaw) sections.push(`【Channel: ${ctx.channelId}】\n${channelRaw}`);
			if (sections.length === 0) return { type: "display", text: "暂无记忆索引" };
			return { type: "display", text: sections.join("\n\n") };
		} catch (err) {
			logger.error("[command] /memories failed:", err);
			return { type: "display", text: "读取记忆失败" };
		}
	},
};
