import { tavilyCrawl, tavilyExtract, tavilyMap } from "@tavily/ai-sdk";
import { tavily } from "@tavily/core";
import { tool } from "ai";
import { z } from "zod";

export const TAVILY_TOOL_GUIDE = [
	'- **tavilySearch**：用于广泛的信息检索——时事、事实、对比、"什么是X"类问题。优先作为你的第一个研究步骤。支持 includeDomains/excludeDomains 参数进行定向搜索，topic 参数可切换新闻/财经模式。',
	"- **tavilyExtract**：当你有特定 URL 并需要其完整内容时使用。不要猜测 URL——先从搜索结果中获取。",
	"- **tavilyCrawl**：当你需要从多页网站获取全面信息时使用。比 extract 开销更大——只在单页不够时使用。",
	"- **tavilyMap**：用于在决定提取哪些页面前了解网站结构。适用于文档类网站。",
].join("\n");

export function createTavilyTools(apiKey?: string) {
	const opts = apiKey ? { apiKey } : {};
	const client = tavily(opts);

	return {
		tavilySearch: {
			...tool({
				description:
					"搜索网页获取最新信息。适用于：(1) 时事新闻、突发事件和时效性话题；(2) 需要最新数据的事实查询；(3) 后续可能需要用 tavilyExtract 或 tavilyCrawl 获取完整页面内容时。如需查询技术/概念性主题、研究论文或文档，请优先使用 exaWebSearch。",
				inputSchema: z.object({
					query: z.string().describe("搜索查询关键词"),
					searchDepth: z
						.enum(["basic", "advanced", "fast", "ultra-fast"])
						.optional()
						.describe(
							"搜索深度：basic 快速结果，advanced 全面搜索，fast 低延迟高相关（BETA），ultra-fast 最低延迟（BETA）",
						),
					timeRange: z
						.enum(["year", "month", "week", "day", "y", "m", "w", "d"])
						.optional()
						.describe("搜索结果的时间范围"),
					topic: z
						.enum(["general", "news", "finance"])
						.optional()
						.describe("搜索主题类别：general 通用，news 新闻，finance 财经"),
					maxResults: z.number().optional().describe("返回的最大结果数量"),
					includeDomains: z
						.array(z.string())
						.optional()
						.describe(
							'限定搜索的域名列表，只返回这些域名的结果（如 ["techcrunch.com", "theverge.com"]）',
						),
					excludeDomains: z
						.array(z.string())
						.optional()
						.describe("排除的域名列表，不返回这些域名的结果"),
					days: z.number().optional().describe("返回最近 N 天内的结果"),
					startDate: z
						.string()
						.optional()
						.describe("搜索结果的起始日期（YYYY-MM-DD 格式，如 2025-01-01）"),
					endDate: z
						.string()
						.optional()
						.describe("搜索结果的截止日期（YYYY-MM-DD 格式，如 2025-12-31）"),
				}),
				execute: async (input) => {
					return await client.search(input.query, {
						searchDepth: input.searchDepth as "basic" | "advanced" | undefined,
						timeRange: input.timeRange,
						topic: input.topic,
						maxResults: input.maxResults,
						includeDomains: input.includeDomains,
						excludeDomains: input.excludeDomains,
						days: input.days,
						startDate: input.startDate,
						endDate: input.endDate,
					});
				},
			}),
		},
		tavilyExtract: {
			...tavilyExtract(opts),
			description:
				"从指定 URL 提取详细内容。适用于：(1) 已有 URL 需要获取完整内容；(2) 用户分享了链接并询问其内容；(3) 搜索结果找到了相关页面但摘要不够详细。不要猜测 URL——先从搜索结果中获取。返回完整页面内容。",
		},
		tavilyCrawl: {
			...tavilyCrawl(opts),
			description:
				"从指定 URL 开始爬取网站，发现并获取多个页面。适用于：(1) 需要从多页网站获取全面信息；(2) 用户需要文档站或 wiki 的完整内容；(3) 单页提取不够用时。比 extract 消耗更大——仅在需要多个页面时使用。返回发现的页面及其内容。",
		},
		tavilyMap: {
			...tavilyMap(opts),
			description:
				"生成网站的站点地图以了解其结构。适用于：(1) 需要在提取前了解网站有哪些页面；(2) 用户想了解网站的结构；(3) 需要从大型网站中找到正确的页面再提取。建议在使用 tavilyCrawl 前先用此工具精确定位。返回发现的 URL 列表。",
		},
	};
}
