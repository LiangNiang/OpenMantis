// packages/core/src/tools/memory/file-store.ts

import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@openmantis/common/logger";
import { ensureDir, MEMORIES_DIR } from "@openmantis/common/paths";
import matter from "gray-matter";
import type { MemoryEntry, MemoryFrontmatter, MemoryType } from "./types";

const logger = createLogger("core/memory");

/**
 * 把 name 转为安全的文件名 slug。
 * - 英文/数字/_/- 保留
 * - 空格 → _
 * - 其他字符（含中文、emoji）剥离
 * - 剥离后若不含任何字母或数字（如纯中文 → 全剥光，或 "张伟-后端组长" → 只剩 "-"），返回空串让调用方走时间戳 fallback
 */
export function slugify(name: string): string {
	const raw = name
		.trim()
		.replace(/\s+/g, "_")
		.replace(/[^a-zA-Z0-9_-]/g, "")
		.toLowerCase();
	// 去掉首尾及连续的分隔符，避免出现 ".md" / "world_-.md" / "user_---.md" 等无信息文件名
	const cleaned = raw.replace(/^[_-]+|[_-]+$/g, "").replace(/[_-]+/g, "_");
	if (!/[a-z0-9]/.test(cleaned)) return "";
	return cleaned;
}

/** 生成最终文件名：<subject>_<slug>.md，slug 为空时回落到时间戳。 */
export function buildFilename(subject: string, name: string, now: Date = new Date()): string {
	const slug = slugify(name);
	if (slug.length > 0) return `${subject}_${slug}.md`;
	const ts = now
		.toISOString()
		.replace(/[-:T.Z]/g, "")
		.slice(0, 14); // YYYYMMDDhhmmss
	return `${subject}_${ts}.md`;
}

function typeDir(type: MemoryType): string {
	return join(MEMORIES_DIR, type);
}

/** 检查目标文件是否存在。 */
export async function fileExists(path: string): Promise<boolean> {
	try {
		const file = Bun.file(path);
		return await file.exists();
	} catch {
		return false;
	}
}

/**
 * 写入单条 memory。同名拒绝（throw "duplicate-filename"）。
 * 调用方负责 conflict 检测、字段校验、相对日期归一化。
 */
export async function writeMemory(args: {
	frontmatter: MemoryFrontmatter;
	body: string;
}): Promise<{ filename: string; absolutePath: string; indexPath: string }> {
	const dir = typeDir(args.frontmatter.type);
	ensureDir(dir);
	const filename = buildFilename(args.frontmatter.subject, args.frontmatter.name);
	const absolutePath = join(dir, filename);

	if (await fileExists(absolutePath)) {
		throw Object.assign(new Error(`duplicate-filename:${filename}`), {
			code: "DUPLICATE_FILENAME",
			filename,
		});
	}

	const content = matter.stringify(`${args.body.trim()}\n`, args.frontmatter);
	await writeFile(absolutePath, content, "utf8");

	return {
		filename,
		absolutePath,
		indexPath: `${args.frontmatter.type}/${filename}`,
	};
}

/** 读取单条 memory。文件不存在抛错。 */
export async function readMemory(args: {
	type: MemoryType;
	filename: string;
}): Promise<MemoryEntry> {
	const dir = typeDir(args.type);
	const absolutePath = join(dir, args.filename);
	const raw = await readFile(absolutePath, "utf8");
	const parsed = matter(raw);
	return {
		frontmatter: parsed.data as MemoryFrontmatter,
		body: parsed.content.trim(),
		filename: args.filename,
		absolutePath,
		indexPath: `${args.type}/${args.filename}`,
	};
}

/** 列出某 type 下的所有 memory。目录不存在则返回空数组。 */
export async function listMemoriesByType(args: { type: MemoryType }): Promise<MemoryEntry[]> {
	const dir = typeDir(args.type);
	let names: string[] = [];
	try {
		const all = await readdir(dir);
		names = all.filter((n) => n.endsWith(".md"));
	} catch {
		return [];
	}
	const out: MemoryEntry[] = [];
	for (const filename of names) {
		try {
			out.push(await readMemory({ ...args, filename }));
		} catch (err) {
			logger.warn(`[memory] failed to parse ${filename}, skipping:`, err);
		}
	}
	return out;
}

/** 删除单条 memory 文件。文件不存在视为成功。 */
export async function deleteMemoryFile(args: {
	type: MemoryType;
	filename: string;
}): Promise<void> {
	const dir = typeDir(args.type);
	const absolutePath = join(dir, args.filename);
	try {
		await unlink(absolutePath);
	} catch (err: any) {
		if (err?.code !== "ENOENT") throw err;
	}
}

/**
 * 更新已有 memory 的 frontmatter 部分字段或 body。
 * 不允许改 type / subject / name / created。
 */
export async function patchMemory(args: {
	type: MemoryType;
	filename: string;
	patch: { description?: string; body?: string } & Partial<
		Pick<MemoryFrontmatter, "when" | "significance" | "trigger" | "deadline">
	>;
}): Promise<MemoryEntry> {
	const current = await readMemory({ type: args.type, filename: args.filename });
	const nextFm: MemoryFrontmatter = { ...current.frontmatter };
	if (args.patch.description !== undefined) nextFm.description = args.patch.description;
	if (args.patch.when !== undefined) nextFm.when = args.patch.when;
	if (args.patch.significance !== undefined) nextFm.significance = args.patch.significance;
	if (args.patch.trigger !== undefined) nextFm.trigger = args.patch.trigger;
	if (args.patch.deadline !== undefined) nextFm.deadline = args.patch.deadline;

	const nextBody = args.patch.body !== undefined ? args.patch.body : current.body;
	const content = matter.stringify(`${nextBody.trim()}\n`, nextFm);
	await writeFile(current.absolutePath, content, "utf8");

	return { ...current, frontmatter: nextFm, body: nextBody };
}
