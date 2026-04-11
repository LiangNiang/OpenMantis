import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createLogger } from "@openmantis/common/logger";
import type { ModelMessage } from "ai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { clearRecentToolSaves, getRecentToolSaves, memoryStore } from "./index";
import { formatLocalDatetime } from "./parser";

const logger = createLogger("core/memory");

const ItemSchema = z.object({
	content: z.string().min(1),
	type: z.enum(["decision", "insight"]),
	tags: z.array(z.string()).optional(),
});
type ExtractedItem = z.infer<typeof ItemSchema>;

const ResultSchema = z.object({
	items: z.array(ItemSchema),
});

const EXTRACT_PROMPT = `You are a memory extraction assistant. Review the following conversation and extract ONLY information worth remembering across future conversations.

Current core memories (for deduplication reference only):
{CORE_CONTENT}

Already saved in this session (DO NOT duplicate these):
{ALREADY_SAVED}

Conversation:
{CONVERSATION}

Output JSON format:
{
  "items": [
    {
      "content": "a single short sentence",
      "type": "decision" | "insight",
      "tags": ["english-tag"]
    }
  ]
}

"type" meanings:
- "decision": an important choice the user explicitly made (e.g., "chose React over Vue", "decided to use cron instead of interval")
- "insight": a non-obvious lesson learned or pattern discovered that has value in future conversations

Rules:
1. Extract ONLY decisions and insights that will be useful in FUTURE conversations.
2. DO NOT extract:
   - Query results (video titles, API prices, search results, user profiles)
   - Tool/environment status (what's installed, what version, what failed)
   - Step-by-step operation logs (what commands were run, what was tested)
   - External information (API documentation, third-party service details)
   - Small talk, greetings, or routine exchanges
   - Anything already in core memories or already saved this session
3. Each item.content MUST be a single short sentence.
4. Write content in the SAME LANGUAGE as the conversation.
5. Tags should always be in English.
6. When in doubt, do NOT extract. Return { "items": [] } if nothing qualifies.`;

/** Track last extracted message count per route to enable incremental extraction. */
const extractedOffsets = new Map<string, number>();

function formatConversation(messages: ModelMessage[]): string {
	return messages
		.map((m) => {
			const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
			const truncated = content.length > 300 ? `${content.slice(0, 300)}...` : content;
			return `[${m.role}] ${truncated}`;
		})
		.join("\n");
}

export async function extractMemories(params: {
	messages: ModelMessage[];
	model: LanguageModelV3;
	channelId: string;
	routeId: string;
	minMessages: number;
}): Promise<void> {
	const { messages, model, channelId, routeId, minMessages } = params;

	const userMessageCount = messages.filter((m) => m.role === "user").length;
	if (userMessageCount < minMessages) {
		logger.debug(`[extractor] skip: only ${userMessageCount} user messages (min: ${minMessages})`);
		return;
	}

	// Incremental extraction: only process messages added since last extraction
	const lastOffset = extractedOffsets.get(routeId) ?? 0;
	if (lastOffset >= messages.length) {
		logger.debug(`[extractor] skip: no new messages since last extraction (offset=${lastOffset})`);
		return;
	}

	const newMessages = lastOffset > 0 ? messages.slice(lastOffset) : messages;
	// Update offset before processing (even if extraction fails, we don't want to retry the same batch)
	extractedOffsets.set(routeId, messages.length);

	try {
		const coreContent = await memoryStore.loadCore(channelId);
		const conversation = formatConversation(newMessages);

		// Get content already saved by save_memory tool in this turn
		const recentSaves = getRecentToolSaves(routeId);
		const alreadySaved =
			recentSaves.length > 0 ? recentSaves.map((s) => `- ${s}`).join("\n") : "(none)";

		const prompt = EXTRACT_PROMPT.replace("{CORE_CONTENT}", coreContent || "(empty)")
			.replace("{ALREADY_SAVED}", alreadySaved)
			.replace("{CONVERSATION}", conversation);

		const items = await runExtraction(model, prompt);
		if (items.length === 0) {
			logger.debug("[extractor] no memories to extract");
			return;
		}

		const now = formatLocalDatetime();

		for (const item of items) {
			logger.info(
				`[extractor] source=extractor → archive/${item.type}: ${item.content.slice(0, 80)}`,
			);
			await memoryStore.saveToArchive(channelId, {
				date: now,
				type: item.type,
				routeId,
				content: item.content,
				tags: item.tags ?? [],
			});
		}

		logger.info(`[extractor] extracted ${items.length} memories for ${channelId}`);
	} catch (err) {
		logger.warn("[extractor] memory extraction failed (silent):", err);
	} finally {
		// Clean up tool saves tracker for this route
		clearRecentToolSaves(routeId);
	}
}

async function runExtraction(model: LanguageModelV3, prompt: string): Promise<ExtractedItem[]> {
	// Primary path: structured output via generateText + Output.object.
	try {
		const { output } = await generateText({
			model,
			output: Output.object({ schema: ResultSchema }),
			prompt,
			temperature: 0,
		});
		return output.items;
	} catch (err) {
		// Structured output can fail on providers without native JSON-schema
		// support, or when the model returns invalid JSON. Fall back to free-form
		// text + manual parse so we still capture memories instead of dropping them.
		logger.debug("[extractor] structured output failed, falling back to generateText:", err);
	}

	const result = await generateText({ model, prompt, temperature: 0 });
	const text = result.text.trim();
	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (!jsonMatch) return [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonMatch[0]);
	} catch {
		return [];
	}

	const validated = ResultSchema.safeParse(parsed);
	if (validated.success) return validated.data.items;

	// Last resort: try parsing as a bare array (legacy prompt format).
	const arrMatch = text.match(/\[[\s\S]*\]/);
	if (arrMatch) {
		try {
			const arr = JSON.parse(arrMatch[0]);
			const arrValidated = z.array(ItemSchema).safeParse(arr);
			if (arrValidated.success) return arrValidated.data;
		} catch {
			// fall through
		}
	}
	return [];
}
