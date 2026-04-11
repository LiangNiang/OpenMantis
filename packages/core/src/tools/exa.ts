import { webSearch } from "@exalabs/ai-sdk";

export function createExaTools(apiKey?: string) {
	const opts = apiKey ? { apiKey } : {};
	return {
		exaWebSearch: {
			...webSearch(opts),
			description:
				"基于 Exa 神经搜索引擎的语义网页搜索。适用于：(1) 技术主题、文档、研究论文和代码相关查询；(2) 需要高质量、深度内容而非突发新闻；(3) 需要语义理解的查询（如概念性问题、「X 是如何工作的」）。搜索前务必先调用 currentTime 获取当前时间。如需查询时事新闻、突发事件，或需要提取/爬取完整页面内容，请优先使用 tavilySearch。",
		},
	};
}
