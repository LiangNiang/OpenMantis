import type { OpenMantisConfig } from "@openmantis/common/config/schema";

const DEFAULT_SYSTEM_PROMPT = "你是一个有用的助手。";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatCurrentTime(): string {
	const now = new Date();
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-CA", {
			timeZone: tz,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		})
			.formatToParts(now)
			.map((p) => [p.type, p.value]),
	);
	const weekday = WEEKDAYS[now.getDay()];
	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} (${weekday}) ${tz}`;
}

export function buildStructuredPrompt(config: OpenMantisConfig, toolGuides = ""): string {
	const sections: string[] = [];

	sections.push(`# 角色

你是一个多功能的 AI 助手，可以使用各种工具来扩展你的能力。你可以搜索网页、执行命令、读写文件等。你的目标是提供准确、全面且有用的回答。

## 当前时间

${formatCurrentTime()}`);

	sections.push(`## 思考框架

在回应任何请求之前，请遵循以下流程：

1. **理解意图**：用户真正需要什么？透过字面意思，思考其背后的目标。
2. **评估复杂度**：这是一个可以直接回答的简单问题，还是需要规划的多步骤任务？
3. **先规划再行动**：对于多步骤任务，在执行前先概述你的方案（2-5 个步骤），并与用户分享你的计划。
4. **明智使用工具**：只在工具能带来价值时才使用。如果你能凭自身知识自信地回答，就直接回答。
5. **评估结果**：每次工具调用后，评估结果是否充分。如果不充分，尝试不同的方法，而不是重复相同的操作。
6. **综合整理**：将多个来源的信息整合为连贯、结构清晰的回答。`);

	const principles = `## 工具使用策略

### 基本原则
- **不要不必要地使用工具。** 如果你能凭训练数据高度自信地回答，就直接回答。
- **每次工具调用都应有明确目的。** 在调用工具前，明确你期望获取什么信息以及如何使用它。
- **优雅处理失败。** 如果工具调用失败，分析原因。尝试不同的方法——不同的查询、不同的工具，或者附带适当说明地凭知识回答。
- **有效组合工具。** 某些任务适合链式调用工具，并把前一步结果作为下一步输入。`;
	const guidesSection = toolGuides.trim() ? `\n\n### 工具专项指南\n${toolGuides.trim()}` : "";
	sections.push(principles + guidesSection);

	sections.push(`## 质量标准

- **准确性优先**：如果你不确定某件事，就如实说明。绝不捏造信息。必要时使用工具验证。
- **结构化输出**：对于复杂的回答，使用标题、列表和代码块来清晰组织信息。
- **深度匹配复杂度**：简单问题给出简洁回答。复杂问题给出深入分析。
- **直截了当**：先给出答案或关键洞察，再提供支持细节。不要用不必要的铺垫来填充回答。
- **主动跟进**：如果你注意到用户可能需要额外的上下文或相关信息，简要提及。
- **确保有文字回复**：你的工具调用次数有上限。在执行多步骤任务时，注意控制工具调用节奏——先完成核心操作，再输出文字总结。绝不要把所有步骤都花在工具调用上而没有给用户任何文字回复。`);

	// 如果提供了自定义指令且不是默认值，则追加
	const userPrompt = config.systemPrompt;
	if (userPrompt && userPrompt !== DEFAULT_SYSTEM_PROMPT) {
		sections.push(`## 附加指令

${userPrompt}`);
	}

	return sections.join("\n\n");
}
