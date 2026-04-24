// packages/core/src/tools/memory/file-store.ts

import { readdirSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir, memoriesScopeDir } from "@openmantis/common/paths";
import matter from "gray-matter";
import type { MemoryEntry, MemoryFrontmatter, MemoryScope, MemoryType } from "./types";

/**
 * 把 name 转为安全的文件名 slug。
 * - 英文/数字/_/- 保留
 * - 空格 → _
 * - 其他字符（含中文、emoji）剥离
 * - 全空时返回空串，调用方需要 fallback
 */
export function slugify(name: string): string {
	return name
		.trim()
		.replace(/\s+/g, "_")
		.replace(/[^a-zA-Z0-9_-]/g, "")
		.toLowerCase();
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

function typeDir(scope: MemoryScope, type: MemoryType, channelId?: string): string {
	return join(memoriesScopeDir(scope, channelId), type);
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
	scope: MemoryScope;
	channelId?: string;
	frontmatter: MemoryFrontmatter;
	body: string;
}): Promise<{ filename: string; absolutePath: string; indexPath: string }> {
	const dir = typeDir(args.scope, args.frontmatter.type, args.channelId);
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
	scope: MemoryScope;
	channelId?: string;
	type: MemoryType;
	filename: string;
}): Promise<MemoryEntry> {
	const dir = typeDir(args.scope, args.type, args.channelId);
	const absolutePath = join(dir, args.filename);
	const raw = await readFile(absolutePath, "utf8");
	const parsed = matter(raw);
	return {
		frontmatter: parsed.data as MemoryFrontmatter,
		body: parsed.content.trim(),
		filename: args.filename,
		absolutePath,
		indexPath: `${args.type}/${args.filename}`,
		scope: args.scope,
	};
}

/** 列出某个 scope + type 下的所有 memory。目录不存在则返回空数组。 */
export async function listMemoriesByType(args: {
	scope: MemoryScope;
	channelId?: string;
	type: MemoryType;
}): Promise<MemoryEntry[]> {
	const dir = typeDir(args.scope, args.type, args.channelId);
	let names: string[] = [];
	try {
		names = readdirSync(dir).filter((n) => n.endsWith(".md"));
	} catch {
		return [];
	}
	const out: MemoryEntry[] = [];
	for (const filename of names) {
		try {
			out.push(await readMemory({ ...args, filename }));
		} catch (err) {
			// 单条解析失败不阻塞，记日志由调用方做
			void err;
		}
	}
	return out;
}

/** 删除单条 memory 文件。文件不存在视为成功。 */
export async function deleteMemoryFile(args: {
	scope: MemoryScope;
	channelId?: string;
	type: MemoryType;
	filename: string;
}): Promise<void> {
	const dir = typeDir(args.scope, args.type, args.channelId);
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
	scope: MemoryScope;
	channelId?: string;
	type: MemoryType;
	filename: string;
	patch: { description?: string; body?: string } & Partial<
		Pick<MemoryFrontmatter, "when" | "significance" | "trigger" | "deadline">
	>;
}): Promise<MemoryEntry> {
	const current = await readMemory(args);
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
