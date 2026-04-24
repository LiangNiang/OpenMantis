// packages/core/src/tools/memory/conflict-v2.ts

import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createLogger } from "@openmantis/common/logger";
import { generateText } from "ai";
import { listMemoriesByType } from "./file-store";
import type { MemoryFrontmatter, MemoryScope } from "./types";

const logger = createLogger("core/memory");

export type ConflictVerdict =
	| { kind: "unique" }
	| {
			kind: "duplicate";
			indexPath: string;
			reason: string;
	  }
	| {
			kind: "conflict";
			indexPath: string;
			reason: string;
	  };

export async function detectConflictV2(args: {
	model: LanguageModelV3;
	scope: MemoryScope;
	channelId?: string;
	candidate: { frontmatter: MemoryFrontmatter; body: string };
}): Promise<ConflictVerdict> {
	const existing = await listMemoriesByType({
		scope: args.scope,
		channelId: args.channelId,
		type: args.candidate.frontmatter.type,
	});

	if (existing.length === 0) return { kind: "unique" };

	const existingText = existing
		.map(
			(e) =>
				`indexPath: ${e.indexPath}\nname: ${e.frontmatter.name}\ndescription: ${e.frontmatter.description}\nbody: ${e.body}`,
		)
		.join("\n---\n");

	const candText = `name: ${args.candidate.frontmatter.name}\ndescription: ${args.candidate.frontmatter.description}\nbody: ${args.candidate.body}`;

	const prompt = `You are a memory deduplication assistant for a long-term memory system.
Given EXISTING memory entries (same scope + same type as the candidate) and a CANDIDATE entry,
decide whether the candidate is:

1. "duplicate" — same fact already recorded; saving would be redundant.
2. "conflict" — directly contradicts an existing entry; should update existing instead of new save.
3. "unique" — does not overlap; safe to save as new.

Output JSON only, no other text.

Schemas:
- {"kind":"unique"}
- {"kind":"duplicate","indexPath":"<exact indexPath of overlapping existing entry>","reason":"<short>"}
- {"kind":"conflict","indexPath":"<exact indexPath of contradicted entry>","reason":"<short>"}

EXISTING:
${existingText}

CANDIDATE:
${candText}`;

	try {
		const { text } = await generateText({ model: args.model, prompt });
		const cleaned = text
			.trim()
			.replace(/^```(?:json)?\s*/i, "")
			.replace(/```\s*$/i, "");
		const parsed = JSON.parse(cleaned) as ConflictVerdict;
		if (parsed.kind !== "unique" && parsed.kind !== "duplicate" && parsed.kind !== "conflict") {
			logger.warn("[conflict-v2] unknown verdict, treating as unique:", parsed);
			return { kind: "unique" };
		}
		return parsed;
	} catch (err) {
		logger.warn("[conflict-v2] LLM call failed, fallback to unique:", err);
		return { kind: "unique" };
	}
}
