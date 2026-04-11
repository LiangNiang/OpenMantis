import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createLogger } from "@openmantis/common/logger";
import { generateText } from "ai";

const logger = createLogger("core/memory");

export interface ConflictResult {
	hasConflict: boolean;
	oldEntries?: string[];
	mergedContent?: string;
	section?: string;
}

const CONFLICT_PROMPT = `You are a memory deduplication assistant. Given existing core memories and a new memory entry, find ALL existing entries that overlap with the new entry and should be consolidated.

Detect these cases:
1. **Contradiction/Update**: new info directly contradicts old (e.g., "likes React" vs "switched to Vue")
2. **Same-category merge**: multiple entries about the same topic should be combined into one (e.g., "likes bananas" + "likes tomatoes" → "likes bananas and tomatoes")
3. **Negation**: new info negates an old entry (e.g., "doesn't like tomatoes" should remove "likes tomatoes" from relevant entries)
4. **No overlap**: new info is independent — no action needed

Rules:
- Return JSON only, no other text
- If no overlap: {"hasConflict": false}
- If any overlap found:
  {"hasConflict": true, "oldEntries": ["<exact text of entry 1>", "<exact text of entry 2>", ...], "mergedContent": "<single consolidated text>", "section": "<section title>"}
- oldEntries must contain the EXACT text of ALL affected entries (copy them precisely from the existing memories)
- mergedContent should be a single concise item that replaces ALL oldEntries
- For negation: mergedContent should EXCLUDE the negated item (e.g., if user says "don't like tomatoes" and old entry is "likes bananas, tomatoes, and lychees", mergedContent should be "likes bananas and lychees")
- Keep mergedContent in the same language as the original entries

Existing core memories:
{CORE_CONTENT}

New memory to check:
{NEW_CONTENT}`;

export async function detectConflict(
	model: LanguageModelV3,
	coreContent: string,
	newContent: string,
): Promise<ConflictResult> {
	if (!coreContent.trim()) {
		return { hasConflict: false };
	}

	try {
		const prompt = CONFLICT_PROMPT.replace("{CORE_CONTENT}", coreContent).replace(
			"{NEW_CONTENT}",
			newContent,
		);

		const result = await generateText({
			model,
			prompt,
			temperature: 0,
		});

		const text = result.text.trim();
		// Extract JSON from response (handle markdown code blocks)
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			logger.warn("[conflict] LLM returned non-JSON response, skipping conflict check");
			return { hasConflict: false };
		}

		const parsed = JSON.parse(jsonMatch[0]);

		// Normalize: support both old single-entry format and new multi-entry format
		let oldEntries: string[] | undefined;
		if (Array.isArray(parsed.oldEntries)) {
			oldEntries = parsed.oldEntries;
		} else if (parsed.oldContent) {
			oldEntries = [parsed.oldContent];
		}

		return {
			hasConflict: !!parsed.hasConflict,
			oldEntries,
			mergedContent: parsed.mergedContent,
			section: parsed.section,
		};
	} catch (err) {
		logger.warn("[conflict] conflict detection failed, degrading to no-check:", err);
		return { hasConflict: false };
	}
}
