/**
 * Markdown parser/serializer for memory files.
 *
 * core.md format:
 *   # Section
 *   - item 1
 *   - item 2
 *
 * archive.md format (grouped by route):
 *   ## route:feishu-group-abc123
 *
 *   ### 2026-04-08 14:30:25 [decision]
 *   Content text here
 *   tags: tech, frontend
 *
 *   ### 2026-04-08 15:00:10 [event]
 *   Another entry
 *   tags: meeting
 */

export interface CoreSection {
	title: string;
	items: string[];
}

export interface ArchiveEntry {
	date: string;
	type: string;
	routeId: string;
	content: string;
	tags: string[];
	raw: string;
}

/** Format a Date as local "YYYY-MM-DD HH:mm:ss". */
export function formatLocalDatetime(d: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ── core.md ──

export function parseCoreMd(text: string): CoreSection[] {
	if (!text.trim()) return [];

	const sections: CoreSection[] = [];
	let current: CoreSection | null = null;

	for (const line of text.split("\n")) {
		const headingMatch = line.match(/^#\s+(.+)/);
		if (headingMatch) {
			current = { title: headingMatch[1]!.trim(), items: [] };
			sections.push(current);
			continue;
		}
		const itemMatch = line.match(/^-\s+(.+)/);
		if (itemMatch && current) {
			current.items.push(itemMatch[1]!.trim());
			continue;
		}
		// Recovery: a non-empty line that's neither a heading nor a bullet
		// is treated as a continuation of the previous bullet (rather than
		// being silently dropped). normalize will later split it apart.
		const trimmed = line.trim();
		if (trimmed && current && current.items.length > 0) {
			const lastIdx = current.items.length - 1;
			current.items[lastIdx] = `${current.items[lastIdx]}\n${trimmed}`;
		}
	}

	return sections;
}

export function serializeCoreMd(sections: CoreSection[]): string {
	return sections
		.filter((s) => s.items.length > 0)
		.map((s) => {
			const items = s.items.map((i) => `- ${i}`).join("\n");
			return `# ${s.title}\n${items}`;
		})
		.join("\n\n")
		.trim();
}

export function addCoreItem(sections: CoreSection[], section: string, item: string): CoreSection[] {
	const existing = sections.find((s) => s.title === section);
	if (existing) {
		existing.items.push(item);
	} else {
		sections.push({ title: section, items: [item] });
	}
	normalizeCoreSections(sections);
	return sections;
}

export function removeCoreItems(sections: CoreSection[], keyword: string): number {
	const lower = keyword.toLowerCase();
	let removed = 0;
	for (const section of sections) {
		const before = section.items.length;
		section.items = section.items.filter((item) => !item.toLowerCase().includes(lower));
		removed += before - section.items.length;
	}
	return removed;
}

/**
 * Normalize sections in-place: split any item containing newlines into
 * multiple items, trim, and drop empty lines.
 */
export function normalizeCoreSections(sections: CoreSection[]): CoreSection[] {
	for (const section of sections) {
		const flattened: string[] = [];
		for (const item of section.items) {
			for (const line of item.split("\n")) {
				const trimmed = line.trim();
				if (trimmed) flattened.push(trimmed);
			}
		}
		section.items = flattened;
	}
	return sections;
}

// ── archive.md ──

/** Old flat format: ## 2026-04-08 [decision] route:xxx */
const ARCHIVE_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s+\[(\w+)\]\s*(?:route:(\S+))?/;
/** New route heading: ## route:xxx */
const ROUTE_HEADING_RE = /^##\s+route:(\S+)/;
/** New sub-entry heading: ### 2026-04-08 14:30:25 [decision] */
const SUB_ENTRY_RE = /^###\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(\w+)\]/;

export function parseArchiveMd(text: string): ArchiveEntry[] {
	if (!text.trim()) return [];

	const entries: ArchiveEntry[] = [];

	// Try new grouped format first
	const routeBlocks = text.split(/(?=^## route:)/m);
	let usedNewFormat = false;

	for (const routeBlock of routeBlocks) {
		const trimmed = routeBlock.trim();
		if (!trimmed) continue;

		const lines = trimmed.split("\n");
		const routeHeading = lines[0] ?? "";
		const routeMatch = routeHeading.match(ROUTE_HEADING_RE);
		if (!routeMatch) continue;

		usedNewFormat = true;
		const routeId = routeMatch[1]!;

		// Split into sub-entries by ### headings
		const subBlocks = trimmed.split(/(?=^### )/m);
		for (const subBlock of subBlocks) {
			const subTrimmed = subBlock.trim();
			const subLines = subTrimmed.split("\n");
			const subHeading = subLines[0] ?? "";
			const subMatch = subHeading.match(SUB_ENTRY_RE);
			if (!subMatch) continue;

			let content = "";
			let tags: string[] = [];

			for (const line of subLines.slice(1)) {
				const tagMatch = line.match(/^tags:\s*(.+)/);
				if (tagMatch) {
					tags = tagMatch[1]!
						.split(",")
						.map((t) => t.trim())
						.filter(Boolean);
					continue;
				}
				if (line.trim()) {
					content += (content ? "\n" : "") + line.trim();
				}
			}

			entries.push({
				date: subMatch[1]!,
				type: subMatch[2]!,
				routeId,
				content,
				tags,
				raw: subTrimmed,
			});
		}
	}

	if (usedNewFormat) return entries;

	// Fallback: parse old flat format for backward compatibility
	const blocks = text.split(/(?=^## )/m);
	for (const block of blocks) {
		const trimmed = block.trim();
		if (!trimmed) continue;

		const lines = trimmed.split("\n");
		const heading = lines[0] ?? "";
		const match = heading.match(ARCHIVE_HEADING_RE);
		if (!match) continue;

		const bodyLines = lines.slice(1);
		let content = "";
		let tags: string[] = [];

		for (const line of bodyLines) {
			const tagMatch = line.match(/^tags:\s*(.+)/);
			if (tagMatch) {
				tags = tagMatch[1]!
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean);
				continue;
			}
			if (line.trim()) {
				content += (content ? "\n" : "") + line.trim();
			}
		}

		entries.push({
			date: match[1]!,
			type: match[2]!,
			routeId: match[3] ?? "",
			content,
			tags,
			raw: trimmed,
		});
	}

	return entries;
}

/** Serialize a single sub-entry (### level) */
export function serializeArchiveSubEntry(entry: {
	date: string;
	type: string;
	content: string;
	tags: string[];
}): string {
	const heading = `### ${entry.date} [${entry.type}]`;
	const lines = [heading, entry.content];
	if (entry.tags.length > 0) lines.push(`tags: ${entry.tags.join(", ")}`);
	return lines.join("\n");
}

/** Serialize a full route block with its sub-entries */
export function serializeArchiveEntry(entry: {
	date: string;
	type: string;
	routeId: string;
	content: string;
	tags: string[];
}): string {
	const routeHeading = `## route:${entry.routeId}`;
	const subEntry = serializeArchiveSubEntry({
		date: entry.date,
		type: entry.type,
		content: entry.content,
		tags: entry.tags,
	});
	return `${routeHeading}\n\n${subEntry}`;
}
