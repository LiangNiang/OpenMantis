import type { LanguageModelV3 } from "@ai-sdk/provider";
import { type OpenMantisConfig, resolveProvider } from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import { generateText, type ModelMessage, Output } from "ai";
import { z } from "zod";
import { createLanguageModel } from "../agent/providers";
import type { Route } from "../gateway/route";
import type { GenerateRecapOutput, RecapResult } from "./types";

const logger = createLogger("core/recap");

const RecapSectionSchema = z.object({
	goal: z.string(),
	decisions: z.string(),
	changes: z.string(),
	todos: z.string(),
});

const RecapResultSchema = z.object({
	heading: z.string(),
	sections: RecapSectionSchema,
});

const RECAP_PROMPT = `你是一个会话回顾助手。阅读下面这段人类用户与 AI Agent 的对话，生成一份结构化回顾。

对话记录：
{CONVERSATION}

输出 JSON，字段含义：
- heading: 一句话概括整段对话在做什么（<= 30 字）
- sections.goal: 用户这次想达成的目标
- sections.decisions: 对话中做出的关键决策（技术选型、方案取舍等）
- sections.changes: 实际产生的改动（文件、命令、外部调用等，来自工具调用记录）
- sections.todos: 尚未完成的事项或未决问题

规则：
1. 用与对话相同的语言写。
2. 每个 section 内容用 markdown bullet 或短段落，不要再嵌套 JSON。
3. 没有内容的 section 写"(无)"而不是省略字段。
4. 不要编造对话里没有的信息。`;

function formatConversation(messages: ModelMessage[]): string {
	return messages
		.map((m) => {
			const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
			const truncated = content.length > 300 ? `${content.slice(0, 300)}...` : content;
			return `[${m.role}] ${truncated}`;
		})
		.join("\n");
}

export interface GenerateRecapParams {
	route: Route;
	config: OpenMantisConfig;
}

export async function generateRecap(params: GenerateRecapParams): Promise<GenerateRecapOutput> {
	const { route, config } = params;
	const providerName = route.provider ?? config.defaultProvider;
	const providerConfig = resolveProvider(config, providerName);
	const modelConfig = providerConfig.models[0]!;
	const model = await createLanguageModel(providerConfig, modelConfig);

	const conversation = formatConversation(route.messages);
	const prompt = RECAP_PROMPT.replace("{CONVERSATION}", conversation);

	const start = Date.now();
	logger.info(
		`[recap] generate: route=${route.id}, provider=${providerName}, model=${modelConfig.id}, messages=${route.messages.length}`,
	);

	const result = await runSummarization(model, prompt);

	logger.info(`[recap] success: route=${route.id}, elapsed=${Date.now() - start}ms`);

	return {
		result,
		provider: providerName,
		modelId: modelConfig.id,
	};
}

async function runSummarization(model: LanguageModelV3, prompt: string): Promise<RecapResult> {
	// Primary: structured output via generateText + Output.object.
	try {
		const { output } = await generateText({
			model,
			output: Output.object({ schema: RecapResultSchema }),
			prompt,
			temperature: 0.3,
		});
		return output;
	} catch (err) {
		logger.debug("[recap] structured output failed, falling back to generateText:", err);
	}

	// Fallback: free-form generateText + manual JSON parse.
	const result = await generateText({ model, prompt, temperature: 0.3 });
	const text = result.text.trim();
	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		throw new Error("recap LLM response contains no JSON object");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonMatch[0]);
	} catch (parseErr) {
		const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
		throw new Error(`recap JSON parse failed: ${msg}`);
	}

	const validated = RecapResultSchema.safeParse(parsed);
	if (!validated.success) {
		throw new Error(`recap JSON schema mismatch: ${validated.error.message}`);
	}
	return validated.data;
}
