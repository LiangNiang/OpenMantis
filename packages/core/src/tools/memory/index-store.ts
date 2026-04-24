// packages/core/src/tools/memory/index-store.ts

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir, memoriesScopeDir } from "@openmantis/common/paths";
import {
	MEMORY_INDEX_HARD_LIMIT,
	MEMORY_INDEX_SOFT_WARN,
	MEMORY_TYPES,
	type MemoryIndexEntry,
	type MemoryScope,
	type MemoryType,
} from "./types";

const INDEX_FILENAME = "MEMORY.md";

function indexPath(scope: MemoryScope, channelId?: string): string {
	const dir = memoriesScopeDir(scope, channelId);
	ensureDir(dir);
	return join(dir, INDEX_FILENAME);
}

/** 读 MEMORY.md，返回结构化 entries 列表。文件不存在返回空。 */
export async function readIndex(
	scope: MemoryScope,
	channelId?: string,
): Promise<MemoryIndexEntry[]> {
	const path = indexPath(scope, channelId);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (err: any) {
		if (err?.code === "ENOENT") return [];
		throw err;
	}

	const entries: MemoryIndexEntry[] = [];
	let currentType: MemoryType | null = null;
	const lineRe = /^- \[([^\]]+)\]\(([^)]+)\) — (.+)$/;
	const headerRe = /^## (.+)$/;

	for (const line of raw.split("\n")) {
		const h = headerRe.exec(line);
		if (h) {
			const t = h[1]?.trim();
			currentType = MEMORY_TYPES.includes(t as MemoryType) ? (t as MemoryType) : null;
			continue;
		}
		const m = lineRe.exec(line);
		if (m && currentType) {
			entries.push({
				type: currentType,
				name: m[1]!,
				indexPath: m[2]!,
				description: m[3]!,
			});
		}
	}
	return entries;
}

/** 序列化 entries 为 MEMORY.md 文本。按 type 分组，组内顺序按传入顺序。 */
export function renderIndex(entries: MemoryIndexEntry[]): string {
	const lines: string[] = ["# Memory Index", ""];
	for (const t of MEMORY_TYPES) {
		const group = entries.filter((e) => e.type === t);
		if (group.length === 0) continue;
		lines.push(`## ${t}`);
		for (const e of group) {
			lines.push(`- [${e.name}](${e.indexPath}) — ${e.description}`);
		}
		lines.push("");
	}
	return lines.join("\n").replace(/\n+$/, "\n");
}

/** 完整重写 MEMORY.md。 */
export async function writeIndex(
	scope: MemoryScope,
	entries: MemoryIndexEntry[],
	channelId?: string,
): Promise<void> {
	const path = indexPath(scope, channelId);
	await writeFile(path, renderIndex(entries), "utf8");
}

export interface AppendResult {
	totalLines: number;
	softWarn: boolean;
	hardLimit: boolean;
}

/**
 * 追加一条索引。组内追加到末尾。
 * 返回新索引总行数 + 软/硬阈值标志。
 * 调用方应在硬阈值时拒绝写入文件本身（已经写了就要回滚）。
 */
export async function appendIndex(args: {
	scope: MemoryScope;
	channelId?: string;
	entry: MemoryIndexEntry;
}): Promise<AppendResult> {
	const current = await readIndex(args.scope, args.channelId);
	current.push(args.entry);
	const text = renderIndex(current);
	const totalLines = text.split("\n").length;

	if (totalLines > MEMORY_INDEX_HARD_LIMIT) {
		return { totalLines, softWarn: true, hardLimit: true };
	}

	await writeIndex(args.scope, current, args.channelId);
	return {
		totalLines,
		softWarn: totalLines > MEMORY_INDEX_SOFT_WARN,
		hardLimit: false,
	};
}

/**
 * 按 indexPath 删除条目。删了多少返回多少；返回 0 表示未匹配。
 */
export async function removeFromIndex(args: {
	scope: MemoryScope;
	channelId?: string;
	indexPath: string;
}): Promise<number> {
	const current = await readIndex(args.scope, args.channelId);
	const next = current.filter((e) => e.indexPath !== args.indexPath);
	const removed = current.length - next.length;
	if (removed > 0) {
		await writeIndex(args.scope, next, args.channelId);
	}
	return removed;
}

/**
 * 根据 indexPath 更新现有条目的 description（用于 update_memory）。
 */
export async function updateIndexEntry(args: {
	scope: MemoryScope;
	channelId?: string;
	indexPath: string;
	description: string;
}): Promise<boolean> {
	const current = await readIndex(args.scope, args.channelId);
	const idx = current.findIndex((e) => e.indexPath === args.indexPath);
	if (idx === -1) return false;
	current[idx] = { ...current[idx]!, description: args.description };
	await writeIndex(args.scope, current, args.channelId);
	return true;
}

/**
 * 模糊匹配 name / description（大小写不敏感、子串）。
 * 用于 forget_memory 的查找。
 */
export async function findIndexEntries(args: {
	scope: MemoryScope;
	channelId?: string;
	keyword: string;
}): Promise<MemoryIndexEntry[]> {
	const current = await readIndex(args.scope, args.channelId);
	const k = args.keyword.toLowerCase();
	return current.filter(
		(e) => e.name.toLowerCase().includes(k) || e.description.toLowerCase().includes(k),
	);
}

/** 直接读 MEMORY.md 原文，用于 prompt 注入。 */
export async function readIndexRaw(scope: MemoryScope, channelId?: string): Promise<string> {
	const path = indexPath(scope, channelId);
	try {
		return (await readFile(path, "utf8")).trim();
	} catch (err: any) {
		if (err?.code === "ENOENT") return "";
		throw err;
	}
}
