import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createLogger } from "@openmantis/common/logger";
import { ROUTES_DIR } from "@openmantis/common/paths";
import { tool } from "ai";
import { z } from "zod";
import { detectConflict } from "./conflict";
import { MemoryStore } from "./memory-store";
import { formatLocalDatetime } from "./parser";

const logger = createLogger("core/tools");

const store = new MemoryStore();

export { store as memoryStore };

/**
 * Contents saved by save_memory tool in the current agent run.
 * Used by the extractor to skip already-saved information.
 * Keyed by routeId.
 */
const recentToolSaves = new Map<string, string[]>();

export function getRecentToolSaves(routeId: string): string[] {
	return recentToolSaves.get(routeId) ?? [];
}

export function clearRecentToolSaves(routeId: string): void {
	recentToolSaves.delete(routeId);
}

export const MEMORY_TOOL_GUIDE = `## Memory Tools
You have access to a long-term memory system with two layers:
1. **Core memory** (## Memory section above) — already loaded into your context. Check there FIRST before using any tool. If the user asks about something in your core memory, just answer directly.
2. **Archive memory** — detailed historical entries searchable via recall_memory.

Tools:
- **save_memory**: Save important information. Use target "core" for stable user information, "archive" for specific events/decisions with date and tags.
- **recall_memory**: Search archive memories by keywords, date range, or tags. Supports multiple keywords (OR match). Use when the user references past conversations or decisions that are NOT in your core memory above.
- **load_route_context**: Load full conversation history from a past session by route ID. Use after recall_memory finds a relevant route.

### Core Memory Sections
Core memory is for stable, cross-conversation user information ONLY. Use these sections when saving to core:
- **Identity** — user's name, role, team, location
- **Preferences** — language preference, interaction style, tool preferences
- **Persona** — user's requirements for your personality/character (e.g., "be concise", "reply in Chinese", "chat like a friend")
- **Context** — long-term project or work context that spans multiple conversations

DO NOT save to core: query results, tool status, external API info, single-session details, or anything that won't matter next week.

### Guidelines
- When the user asks about their preferences or facts, check your core memory (## Memory section) FIRST.
- When the user shares preferences, sets persona requirements, or reveals identity info, proactively save to core.
- When the user explicitly asks you to remember something, always save it.
- When searching, use multiple keywords in different languages if the topic might be stored in either language (e.g., ["怀孕", "pregnancy"]).`;

export function createMemoryTools(ctx: {
	channelId: string;
	routeId: string;
	model?: LanguageModelV3;
}) {
	const { channelId, routeId, model } = ctx;

	// 每轮对话最多写入 1 次：createMemoryTools 在每次 agent 运行时调用一次，
	// 闭包内的计数器天然以"一轮对话"为作用域。
	let saveCount = 0;

	// Clear previous saves for this route at the start of a new turn
	clearRecentToolSaves(routeId);

	return {
		save_memory: tool({
			description:
				"保存重要信息到长期记忆。target 为 core 时写入核心记忆（始终可见），为 archive 时写入归档记忆（按需检索）。保存用户偏好、身份信息用 core；保存具体事件、决策用 archive。**每轮对话最多调用 1 次**，请把要记的内容一次性合并好再写入。",
			inputSchema: z.object({
				content: z.string().describe("要记住的内容"),
				target: z
					.enum(["core", "archive"])
					.describe("存储目标：core（核心记忆）或 archive（归档记忆）"),
				memoryType: z
					.enum(["preference", "fact", "decision", "event", "insight"])
					.describe("记忆类型分类"),
				section: z
					.string()
					.optional()
					.describe(
						"core.md 中的分区标题（仅 target=core 时使用），如 Identity, Preferences, Persona, Context",
					),
				tags: z
					.array(z.string())
					.optional()
					.describe("标签列表（仅 target=archive 时使用），如 ['tech', 'frontend']"),
				async: z
					.boolean()
					.optional()
					.describe(
						"是否异步（后台）执行，不阻塞当前对话。默认 true。仅在用户明确要求确认保存结果时设为 false。",
					),
			}),
			execute: async (input) => {
				logger.info(
					`[tool:memory] source=model-tool route=${routeId} target=${input.target} type=${input.memoryType} section=${input.section ?? "-"} async=${input.async ?? true} content=${input.content.slice(0, 80)}`,
				);
				if (saveCount >= 1) {
					logger.warn(
						`[tool:memory] save_memory rejected: per-turn limit reached (route=${routeId})`,
					);
					return "本轮对话已写入过记忆，每轮最多写入 1 次。请直接回复用户，不要继续保存记忆。";
				}
				saveCount++;

				// Track what was saved so extractor can skip duplicates
				const saves = recentToolSaves.get(routeId) ?? [];
				saves.push(input.content);
				recentToolSaves.set(routeId, saves);

				const fireAsync = input.async !== false; // default true

				const persist = async () => {
					if (input.target === "core") {
						const section = input.section ?? "General";

						// Conflict detection
						if (model) {
							const coreContent = await store.loadCore(channelId);
							const conflict = await detectConflict(model, coreContent, input.content);
							if (conflict.hasConflict && conflict.oldEntries?.length) {
								const finalContent = conflict.mergedContent ?? input.content;
								await store.supersede(
									channelId,
									conflict.oldEntries,
									finalContent,
									conflict.section ?? section,
									routeId,
								);
								return `已更新核心记忆（已合并）：${finalContent}`;
							}
						}

						await store.saveToCore(channelId, section, input.content);
						return `已保存到核心记忆 [${section}]：${input.content}`;
					}

					// archive
					const now = formatLocalDatetime();
					await store.saveToArchive(channelId, {
						date: now,
						type: input.memoryType,
						routeId,
						content: input.content,
						tags: input.tags ?? [],
					});
					return `已保存到归档记忆 [${input.memoryType}]：${input.content}`;
				};

				if (fireAsync) {
					// Fire-and-forget: return immediately, persist in the background.
					persist().catch((err) => {
						logger.error("[tool:memory] save_memory background persist failed:", err);
					});
					return input.target === "core"
						? `已保存到核心记忆 [${input.section ?? "General"}]：${input.content}`
						: `已保存到归档记忆 [${input.memoryType}]：${input.content}`;
				}

				// Synchronous: await result so agent sees actual outcome
				try {
					return await persist();
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					logger.error("[tool:memory] save_memory failed:", err);
					return `保存记忆失败：${message}`;
				}
			},
		}),

		recall_memory: tool({
			description:
				"从归档记忆中检索信息。支持按多个关键词（OR 匹配）、日期范围、标签、类型过滤。返回匹配的记忆条目及其关联的 route 信息（默认最多 20 条，最新优先）。建议同时提供中英文关键词以提高召回率。",
			inputSchema: z.object({
				keywords: z
					.array(z.string())
					.optional()
					.describe("搜索关键词列表（OR 匹配），建议包含中英文，如 ['怀孕', 'pregnancy']"),
				dateFrom: z.string().optional().describe("起始日期（YYYY-MM-DD），如 2026-04-06"),
				dateTo: z.string().optional().describe("截止日期（YYYY-MM-DD），如 2026-04-08"),
				tags: z.array(z.string()).optional().describe("按标签过滤"),
				memoryType: z
					.enum(["preference", "fact", "decision", "event", "insight"])
					.optional()
					.describe("按记忆类型过滤"),
				includeSuperseded: z.boolean().optional().describe("是否包含已被替代的旧记忆，默认 false"),
				limit: z.number().int().positive().optional().describe("最多返回条数，默认 20"),
			}),
			execute: async (input) => {
				logger.debug("[tool:memory] recall_memory:", input);
				try {
					const entries = await store.searchArchive(channelId, {
						keywords: input.keywords,
						dateFrom: input.dateFrom,
						dateTo: input.dateTo,
						tags: input.tags,
						type: input.memoryType,
						includeSuperseded: input.includeSuperseded,
					});

					if (entries.length === 0) {
						return "未找到匹配的记忆。";
					}

					const limit = input.limit ?? 20;
					const total = entries.length;
					const truncated = entries.slice(0, limit);

					const results = truncated.map((e) => ({
						date: e.date,
						type: e.type,
						content: e.content,
						tags: e.tags,
						routeId: e.routeId,
					}));

					let output = JSON.stringify(results, null, 2);
					if (total > limit) {
						output += `\n\n（共 ${total} 条匹配，当前显示最新 ${limit} 条。如需查看更多，请增大 limit 参数或缩小搜索范围。）`;
					}
					return output;
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					logger.error("[tool:memory] recall_memory failed:", err);
					return `检索记忆失败：${message}`;
				}
			},
		}),

		load_route_context: tool({
			description:
				"根据 route ID 加载历史对话记录。用于在 recall_memory 找到相关记忆后，加载完整的对话上下文以获取更多细节。返回最近 50 条消息。",
			inputSchema: z.object({
				routeId: z.string().describe("要加载的 route ID（从 recall_memory 结果中获取）"),
			}),
			execute: async (input) => {
				logger.debug(`[tool:memory] load_route_context: ${input.routeId}`);
				try {
					const filePath = `${ROUTES_DIR}/${input.routeId}.json`;
					const file = Bun.file(filePath);
					if (!(await file.exists())) {
						return `未找到 route: ${input.routeId}`;
					}
					const data = await file.json();
					const messages = (data.messages ?? []) as { role: string; content: unknown }[];
					const recent = messages.slice(-50);
					const formatted = recent.map((m) => {
						const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
						const truncated = text.length > 500 ? `${text.slice(0, 500)}...` : text;
						return `[${m.role}] ${truncated}`;
					});
					return formatted.join("\n\n");
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					logger.error("[tool:memory] load_route_context failed:", err);
					return `加载对话记录失败：${message}`;
				}
			},
		}),
	};
}
