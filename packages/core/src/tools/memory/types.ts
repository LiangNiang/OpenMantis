export const MEMORY_TYPES = ["semantic", "procedural", "episodic", "prospective"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_SUBJECTS = ["user", "agent", "world", "reference"] as const;
export type MemorySubject = (typeof MEMORY_SUBJECTS)[number];

export const MEMORY_SCOPES = ["global", "channel"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export interface MemoryFrontmatter {
	name: string;
	description: string;
	type: MemoryType;
	subject: MemorySubject;
	created: string; // YYYY-MM-DD
	// 类型特有字段
	when?: string; // YYYY-MM-DD（episodic 必填）
	significance?: "low" | "medium" | "high"; // episodic 可选
	trigger?: string; // prospective 至少一个
	deadline?: string; // YYYY-MM-DD（prospective 至少一个）
}

export interface MemoryEntry {
	frontmatter: MemoryFrontmatter;
	body: string;
	/** 文件名（不含 type 目录），如 `agent_chinese_reply.md` */
	filename: string;
	/** 完整绝对路径 */
	absolutePath: string;
	/** 索引相对路径，如 `procedural/agent_chinese_reply.md` */
	indexPath: string;
	scope: MemoryScope;
}

export interface MemoryIndexEntry {
	type: MemoryType;
	name: string;
	description: string;
	indexPath: string; // 如 `procedural/agent_chinese_reply.md`
}

export const MEMORY_INDEX_HARD_LIMIT = 500;
export const MEMORY_INDEX_SOFT_WARN = 400;
