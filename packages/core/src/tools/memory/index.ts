// packages/core/src/tools/memory/index.ts

import { readFile, unlink } from "node:fs/promises";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createLogger } from "@openmantis/common/logger";
import { ROUTES_DIR } from "@openmantis/common/paths";
import { tool } from "ai";
import { z } from "zod";
import { detectConflictV2 } from "./conflict-v2";
import { formatDate, normalizeRelativeDates } from "./date-normalize";
import { deleteMemoryFile, patchMemory, writeMemory } from "./file-store";
import { appendIndex, findIndexEntries, removeFromIndex, updateIndexEntry } from "./index-store";
import {
	MEMORY_SCOPES,
	MEMORY_SUBJECTS,
	MEMORY_TYPES,
	type MemoryFrontmatter,
	type MemoryScope,
	type MemoryType,
} from "./types";

const logger = createLogger("core/tools");

export const MEMORY_TOOL_GUIDE = `## Memory System

You have a long-term memory split across two scopes:
- **Global Memory** — facts that hold across all channels (user identity, persistent preferences for the agent's behavior).
- **Channel Memory** — facts specific to the current channel (this channel's persona, channel-specific people, ongoing topics).

Each scope has a \`MEMORY.md\` index already loaded into your system prompt. Each entry in the index points to a single .md file you can Read with the file tool when you need full content.

### Memory types (based on human cognitive memory)

- **semantic** — stable facts about a subject (who/what something is). Body free-form. Subject usually \`user\` / \`world\` / \`reference\`.
- **procedural** — how the agent should behave (persona, style, corrections, restrictions). Subject usually \`agent\`. **Body must contain \`**Why:**\` and \`**How to apply:**\` lines.**
- **episodic** — past event worth remembering long-term (with date/significance). Subject usually \`user\`. **Frontmatter must include \`when\` (YYYY-MM-DD).**
- **prospective** — future-oriented intent (deadline or trigger). Subject usually \`user\`. **Frontmatter must include either \`trigger\` or \`deadline\`.**

### When to save (use save_memory)
- User shares identity / preferences / knowledge background → semantic
- User corrects or confirms your behavior → procedural (agent)
- User mentions a third-party entity worth remembering (person/pet/org/place) → semantic / subject:world
- User shares a meaningful past event → episodic
- User states a future plan / commitment / deadline → prospective
- User mentions an external resource pointer (URL, project ID, dashboard) → semantic / subject:reference

### When to read (use Read on the file path from the index)
- User references something the index hints at — Read the file before responding
- Before acting on memory that names a specific file/function/flag, Read or grep to verify it still exists ("memory says X exists" ≠ "X exists now")

### Do NOT save
- Code patterns / file paths / architecture (git/grep can recover)
- Fix recipes / debugging conclusions (commits already record)
- One-off conversation context / temporary state
- Anything already in CLAUDE.md
- Even if user asks you to remember it — if it falls into the above, ask "what about this is worth keeping across conversations?"

### Other tools
- **forget_memory** — fuzzy-match by name/description and remove. Asks for disambiguation if multiple match.
- **update_memory** — patch an existing memory's description / body / type-specific fields.
- **load_route_context** — load full message history from a past route by ID (independent of memory).`;

const saveSchema = z.object({
	type: z.enum(MEMORY_TYPES).describe("semantic / procedural / episodic / prospective"),
	subject: z
		.enum(MEMORY_SUBJECTS)
		.describe("Whom this memory is about: user / agent / world / reference"),
	scope: z
		.enum(MEMORY_SCOPES)
		.default("channel")
		.describe("`global` for cross-channel, `channel` for current"),
	name: z.string().min(1).max(80).describe("Short title; used in MEMORY.md and as filename slug"),
	description: z
		.string()
		.min(1)
		.max(150)
		.describe("One-line hook (≤150 chars) shown in MEMORY.md index"),
	body: z
		.string()
		.min(1)
		.describe("Main content. For procedural: must include **Why:** and **How to apply:** lines"),
	when: z.string().optional().describe("YYYY-MM-DD; required for episodic"),
	significance: z.enum(["low", "medium", "high"]).optional(),
	trigger: z.string().optional().describe("Free text; required for prospective if no deadline"),
	deadline: z.string().optional().describe("YYYY-MM-DD; required for prospective if no trigger"),
});

function validateTypeFields(input: z.infer<typeof saveSchema>): string | null {
	if (input.type === "episodic") {
		if (!input.when) return "episodic memory requires `when` (YYYY-MM-DD)";
	}
	if (input.type === "prospective") {
		if (!input.trigger && !input.deadline)
			return "prospective memory requires `trigger` or `deadline`";
	}
	if (input.type === "procedural") {
		const hasWhy = /\*\*Why:\*\*/.test(input.body);
		const hasHow = /\*\*How to apply:\*\*/.test(input.body);
		if (!hasWhy || !hasHow) {
			return "procedural memory body must include both **Why:** and **How to apply:** lines";
		}
	}
	return null;
}

async function loadRouteMessages(routeId: string): Promise<string> {
	const path = `${ROUTES_DIR}/${routeId}.json`;
	const raw = await readFile(path, "utf8");
	const data = JSON.parse(raw) as { messages?: any[] };
	const messages = data.messages ?? [];
	const recent = messages.slice(-50);
	return JSON.stringify(recent, null, 2);
}

export function createMemoryTools(ctx: { channelId: string; model?: LanguageModelV3 }) {
	const { channelId, model } = ctx;
	let saveCount = 0;

	return {
		save_memory: tool({
			description:
				"Save a memory to long-term storage. See system prompt for type rules. Limited to 1 call per turn.",
			inputSchema: saveSchema,
			async execute(input): Promise<string> {
				if (saveCount >= 1) {
					return "save_memory has already been called this turn (1/turn limit). Skip or use update_memory.";
				}
				saveCount += 1;

				const fieldErr = validateTypeFields(input);
				if (fieldErr) return `validation error: ${fieldErr}`;

				const today = formatDate(new Date());
				const normalizedBody = normalizeRelativeDates(input.body);
				const frontmatter: MemoryFrontmatter = {
					name: input.name,
					description: input.description,
					type: input.type as MemoryType,
					subject: input.subject as MemoryFrontmatter["subject"],
					created: today,
					...(input.when ? { when: normalizeRelativeDates(input.when) } : {}),
					...(input.significance ? { significance: input.significance } : {}),
					...(input.trigger ? { trigger: normalizeRelativeDates(input.trigger) } : {}),
					...(input.deadline ? { deadline: normalizeRelativeDates(input.deadline) } : {}),
				};

				const scope = input.scope as MemoryScope;
				const channelArg = scope === "global" ? undefined : channelId;

				if (model) {
					try {
						const verdict = await detectConflictV2({
							model,
							scope,
							channelId: channelArg,
							candidate: { frontmatter, body: normalizedBody },
						});
						if (verdict.kind === "duplicate") {
							return `Skipped: duplicate of existing memory "${verdict.indexPath}" (${verdict.reason}). Use update_memory if you want to refine it.`;
						}
						if (verdict.kind === "conflict") {
							return `Skipped: conflicts with existing memory "${verdict.indexPath}" (${verdict.reason}). Use update_memory to revise the existing entry.`;
						}
					} catch (err) {
						logger.warn("[save_memory] conflict detection failed, proceeding:", err);
					}
				}

				let written: { filename: string; absolutePath: string; indexPath: string };
				try {
					written = await writeMemory({
						scope,
						channelId: channelArg,
						frontmatter,
						body: normalizedBody,
					});
				} catch (err: any) {
					if (err?.code === "DUPLICATE_FILENAME") {
						return `Filename collision (${err.filename}). Pick a different \`name\` and retry.`;
					}
					logger.error("[save_memory] write failed:", err);
					return `save failed: ${err?.message ?? "unknown"}`;
				}

				let append: { totalLines: number; softWarn: boolean; hardLimit: boolean };
				try {
					append = await appendIndex({
						scope,
						channelId: channelArg,
						entry: {
							type: frontmatter.type,
							name: frontmatter.name,
							description: frontmatter.description,
							indexPath: written.indexPath,
						},
					});
				} catch (err) {
					logger.error("[save_memory] index update failed, rolling back file:", err);
					try {
						await unlink(written.absolutePath);
					} catch (unlinkErr) {
						logger.warn(
							`[save_memory] rollback unlink failed for ${written.absolutePath}:`,
							unlinkErr,
						);
					}
					return `Index update failed: ${(err as Error).message}. File rolled back.`;
				}

				if (append.hardLimit) {
					// 已经写了文件但索引拒绝写入：回滚文件
					try {
						await unlink(written.absolutePath);
					} catch (unlinkErr) {
						logger.warn(
							`[save_memory] rollback unlink failed for ${written.absolutePath}:`,
							unlinkErr,
						);
					}
					return `MEMORY.md hit hard limit (${append.totalLines} > 500 lines). File rolled back. Run /forget on stale entries before retrying.`;
				}

				const warn = append.softWarn
					? ` (warning: index at ${append.totalLines}/500 lines, consider cleanup)`
					: "";
				return `Saved [${frontmatter.type}/${frontmatter.subject}] "${frontmatter.name}" → ${scope}/${written.indexPath}${warn}`;
			},
		}),

		load_route_context: tool({
			description:
				"Load full message history from a past route by ID. Use sparingly. Returns last 50 messages of that route as JSON.",
			inputSchema: z.object({
				routeId: z.string().describe("The route ID (must exist under routes/)"),
			}),
			async execute({ routeId: id }): Promise<string> {
				try {
					return await loadRouteMessages(id);
				} catch (err) {
					logger.warn("[load_route_context] failed:", err);
					return `Failed to load route ${id}: ${(err as Error).message}`;
				}
			},
		}),

		forget_memory: tool({
			description:
				"Remove a memory by fuzzy keyword match (against name + description). If multiple match, returns candidates and asks for a more specific keyword.",
			inputSchema: z.object({
				keyword: z.string().min(1).describe("Fuzzy substring matched against name/description"),
				scope: z
					.enum(["global", "channel", "all"] as const)
					.default("all")
					.describe("Where to search; default both"),
			}),
			async execute({ keyword, scope }): Promise<string> {
				const scopes: Array<{ scope: MemoryScope; channel?: string }> = [];
				if (scope === "global" || scope === "all") scopes.push({ scope: "global" });
				if (scope === "channel" || scope === "all")
					scopes.push({ scope: "channel", channel: channelId });

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

				if (hits.length === 0) return `No memory matched "${keyword}".`;
				if (hits.length > 1) {
					const list = hits
						.map((h, i) => `${i + 1}. [${h.scope}] ${h.name} — ${h.description} (${h.indexPath})`)
						.join("\n");
					return `Multiple matches; refine keyword:\n${list}`;
				}

				const h = hits[0]!;
				const [type, filename] = h.indexPath.split("/") as [MemoryType, string];
				await deleteMemoryFile({ scope: h.scope, channelId: h.channel, type, filename });
				await removeFromIndex({ scope: h.scope, channelId: h.channel, indexPath: h.indexPath });
				return `Forgot [${h.scope}] ${h.name}`;
			},
		}),

		update_memory: tool({
			description:
				"Patch an existing memory. Cannot change type / subject / name / created — for those, forget and re-save.",
			inputSchema: z.object({
				scope: z.enum(["global", "channel"] as const),
				type: z.enum(MEMORY_TYPES),
				filename: z.string().describe("Filename within the type dir, e.g. agent_chinese_reply.md"),
				description: z.string().optional(),
				body: z.string().optional(),
				when: z.string().optional(),
				significance: z.enum(["low", "medium", "high"]).optional(),
				trigger: z.string().optional(),
				deadline: z.string().optional(),
			}),
			async execute(input): Promise<string> {
				const scope = input.scope as MemoryScope;
				const channelArg = scope === "global" ? undefined : channelId;

				try {
					const updated = await patchMemory({
						scope,
						channelId: channelArg,
						type: input.type as MemoryType,
						filename: input.filename,
						patch: {
							description: input.description,
							body: input.body,
							when: input.when ? normalizeRelativeDates(input.when) : undefined,
							significance: input.significance,
							trigger: input.trigger ? normalizeRelativeDates(input.trigger) : undefined,
							deadline: input.deadline ? normalizeRelativeDates(input.deadline) : undefined,
						},
					});
					if (input.description !== undefined) {
						await updateIndexEntry({
							scope,
							channelId: channelArg,
							indexPath: `${input.type}/${input.filename}`,
							description: input.description,
						});
					}
					return `Updated [${updated.frontmatter.type}/${updated.frontmatter.subject}] "${updated.frontmatter.name}"`;
				} catch (err: any) {
					if (err?.code === "ENOENT")
						return `Memory not found: ${input.scope}/${input.type}/${input.filename}`;
					logger.error("[update_memory] failed:", err);
					return `update failed: ${err?.message ?? "unknown"}`;
				}
			},
		}),
	};
}

// 临时 shim：保留旧 export 让外部引用不立刻爆错。Task 8-11 完成后删除。
export const memoryStore = {
	loadCore: async (_channelId: string): Promise<string> => "",
	saveToCore: async (_channelId: string, _section: string, _content: string): Promise<void> => {},
	removeFromCore: async (_channelId: string, _keyword: string): Promise<number> => 0,
	saveToArchive: async (_channelId: string, _entry: any): Promise<void> => {},
};
export const extractMemories = async () => {
	logger.warn("extractMemories is deprecated and disabled in v2");
};
export function getRecentToolSaves(_routeId: string): string[] {
	return [];
}
export function clearRecentToolSaves(_routeId: string): void {}
