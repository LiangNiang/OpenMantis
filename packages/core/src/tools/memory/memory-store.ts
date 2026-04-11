import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@openmantis/common/logger";
import { MEMORIES_DIR } from "@openmantis/common/paths";
import {
	type ArchiveEntry,
	addCoreItem,
	type CoreSection,
	formatLocalDatetime,
	parseArchiveMd,
	parseCoreMd,
	removeCoreItems,
	serializeArchiveEntry,
	serializeArchiveSubEntry,
	serializeCoreMd,
} from "./parser";

const logger = createLogger("core/memory");

export interface ArchiveSearchQuery {
	keywords?: string[];
	dateFrom?: string;
	dateTo?: string;
	tags?: string[];
	type?: string;
	includeSuperseded?: boolean;
}

export class MemoryStore {
	private locks = new Map<string, Promise<void>>();

	private userDir(channelId: string): string {
		return join(MEMORIES_DIR, channelId);
	}

	private corePath(channelId: string): string {
		return join(this.userDir(channelId), "core.md");
	}

	private archivePath(channelId: string): string {
		return join(this.userDir(channelId), "archive.md");
	}

	private async ensureDir(channelId: string): Promise<void> {
		await mkdir(this.userDir(channelId), { recursive: true });
	}

	private async readFile(path: string): Promise<string> {
		try {
			const file = Bun.file(path);
			if (!(await file.exists())) return "";
			return await file.text();
		} catch {
			return "";
		}
	}

	private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.locks.get(key) ?? Promise.resolve();
		let resolve: () => void;
		const next = new Promise<void>((r) => {
			resolve = r;
		});
		this.locks.set(key, next);

		await prev;
		try {
			return await fn();
		} finally {
			resolve!();
			if (this.locks.get(key) === next) {
				this.locks.delete(key);
			}
		}
	}

	// ── Read ──

	async loadCore(channelId: string): Promise<string> {
		return this.readFile(this.corePath(channelId));
	}

	async loadCoreSections(channelId: string): Promise<CoreSection[]> {
		const text = await this.loadCore(channelId);
		return parseCoreMd(text);
	}

	async searchArchive(channelId: string, query: ArchiveSearchQuery): Promise<ArchiveEntry[]> {
		const text = await this.readFile(this.archivePath(channelId));
		let entries = parseArchiveMd(text);

		if (!query.includeSuperseded) {
			entries = entries.filter((e) => e.type !== "superseded");
		}

		if (query.dateFrom) {
			entries = entries.filter((e) => e.date.slice(0, 10) >= query.dateFrom!.slice(0, 10));
		}
		if (query.dateTo) {
			entries = entries.filter((e) => e.date.slice(0, 10) <= query.dateTo!.slice(0, 10));
		}
		if (query.keywords && query.keywords.length > 0) {
			const lowerKeywords = query.keywords.map((k) => k.toLowerCase());
			entries = entries.filter((e) => {
				const lowerContent = e.content.toLowerCase();
				const lowerTags = e.tags.map((t) => t.toLowerCase());
				return lowerKeywords.some(
					(kw) => lowerContent.includes(kw) || lowerTags.some((t) => t.includes(kw)),
				);
			});
		}
		if (query.tags && query.tags.length > 0) {
			const queryTags = query.tags.map((t) => t.toLowerCase());
			entries = entries.filter((e) =>
				queryTags.some((qt) => e.tags.some((et) => et.toLowerCase().includes(qt))),
			);
		}
		if (query.type) {
			entries = entries.filter((e) => e.type === query.type);
		}

		// Sort by date descending (newest first)
		entries.sort((a, b) => b.date.localeCompare(a.date));

		return entries;
	}

	// ── Write ──

	async saveToCore(channelId: string, section: string, item: string): Promise<void> {
		await this.withLock(channelId, async () => {
			await this.ensureDir(channelId);
			const sections = await this.loadCoreSections(channelId);
			addCoreItem(sections, section, item);
			await Bun.write(this.corePath(channelId), serializeCoreMd(sections));
			logger.debug(`[memory-store] saved to core: ${channelId} / ${section}`);
		});
	}

	async writeCoreRaw(channelId: string, content: string): Promise<void> {
		await this.withLock(channelId, async () => {
			await this.ensureDir(channelId);
			await Bun.write(this.corePath(channelId), content);
			logger.debug(`[memory-store] wrote core raw: ${channelId}`);
		});
	}

	async saveToArchive(
		channelId: string,
		entry: {
			date: string;
			type: string;
			routeId: string;
			content: string;
			tags: string[];
		},
	): Promise<void> {
		await this.withLock(channelId, async () => {
			await this.ensureDir(channelId);
			const existing = await this.readFile(this.archivePath(channelId));

			const routeMarker = `## route:${entry.routeId}`;
			const subEntry = serializeArchiveSubEntry({
				date: entry.date,
				type: entry.type,
				content: entry.content,
				tags: entry.tags,
			});

			let updated: string;
			if (existing.includes(routeMarker)) {
				// Append sub-entry to existing route block
				const routeIdx = existing.indexOf(routeMarker);
				const afterRoute = existing.indexOf("\n## route:", routeIdx + routeMarker.length);
				if (afterRoute === -1) {
					updated = `${existing.trimEnd()}\n\n${subEntry}`;
				} else {
					const before = existing.slice(0, afterRoute).trimEnd();
					const after = existing.slice(afterRoute);
					updated = `${before}\n\n${subEntry}${after}`;
				}
			} else {
				// New route block — prepend (reverse chronological by route)
				const newBlock = serializeArchiveEntry(entry);
				updated = existing.trim() ? `${newBlock}\n\n${existing.trim()}` : newBlock;
			}

			await Bun.write(this.archivePath(channelId), updated);
			logger.debug(`[memory-store] saved to archive: ${channelId} / ${entry.type}`);
		});
	}

	async supersede(
		channelId: string,
		oldEntries: string[],
		newItem: string,
		section: string,
		routeId: string,
	): Promise<void> {
		const today = formatLocalDatetime();

		await this.withLock(channelId, async () => {
			await this.ensureDir(channelId);

			// 1. Remove all matching old items from core
			const sections = await this.loadCoreSections(channelId);
			const lowerEntries = oldEntries.map((e) => e.toLowerCase());
			for (const s of sections) {
				s.items = s.items.filter(
					(i) => !lowerEntries.some((lower) => i.toLowerCase().includes(lower)),
				);
			}
			// 2. Add new merged item to core
			addCoreItem(sections, section, newItem);
			await Bun.write(this.corePath(channelId), serializeCoreMd(sections));

			// 3. Archive old entries as superseded
			const existing = await this.readFile(this.archivePath(channelId));
			const supersededBlock = serializeArchiveEntry({
				date: today,
				type: "superseded",
				routeId,
				content: `${oldEntries.join(" | ")} (updated ${today}: ${newItem})`,
				tags: [],
			});
			const updated = existing.trim()
				? `${supersededBlock}\n\n${existing.trim()}`
				: supersededBlock;
			await Bun.write(this.archivePath(channelId), updated);

			logger.debug(`[memory-store] superseded ${oldEntries.length} entries in core: ${channelId}`);
		});
	}

	// ── Delete ──

	async removeFromCore(channelId: string, keyword: string): Promise<number> {
		return this.withLock(channelId, async () => {
			const sections = await this.loadCoreSections(channelId);
			const removed = removeCoreItems(sections, keyword);
			if (removed > 0) {
				await Bun.write(this.corePath(channelId), serializeCoreMd(sections));
				logger.debug(`[memory-store] removed ${removed} items from core: ${channelId}`);
			}
			return removed;
		});
	}
}
