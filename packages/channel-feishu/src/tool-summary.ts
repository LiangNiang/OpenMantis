/**
 * Smart-summarize tool arguments for display in the tool info card.
 */
export function summarizeArgs(args: Record<string, unknown>): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(args)) {
		parts.push(`${key}: ${formatValue(value)}`);
	}
	return parts.join("  ");
}

function formatValue(value: unknown): string {
	if (value === null || value === undefined) return String(value);
	if (typeof value === "string") {
		if (value.length > 80) {
			return `"${value.slice(0, 40)}...${value.slice(-20)}" (共${value.length}字符)`;
		}
		return `"${value}"`;
	}
	if (Array.isArray(value)) {
		const items = value.map((v) => (typeof v === "string" ? `"${v}"` : String(v)));
		const joined = `[${items.join(", ")}]`;
		if (joined.length > 120) return `${joined.slice(0, 120)}...`;
		return joined;
	}
	if (typeof value === "object") return "{...}";
	return String(value);
}

/**
 * Smart-summarize tool result based on tool type.
 */
export function summarizeResult(toolName: string, result: string): string {
	// Search tools: show result count
	if (/search|grep|glob|exa/i.test(toolName)) {
		return summarizeSearchResult(result);
	}
	// Bash: show last 3 lines
	if (/bash/i.test(toolName)) {
		return summarizeBashResult(result);
	}
	// Default: truncate
	if (result.length > 150) {
		return result.slice(0, 150) + "...";
	}
	return result;
}

function summarizeSearchResult(result: string): string {
	try {
		const parsed = JSON.parse(result);
		if (Array.isArray(parsed)) return `返回 ${parsed.length} 条结果`;
		if (parsed?.results && Array.isArray(parsed.results))
			return `返回 ${parsed.results.length} 条结果`;
		if (parsed?.length != null) return `返回 ${parsed.length} 条结果`;
	} catch {
		// not JSON, count lines as fallback
		const lines = result.trim().split("\n").filter(Boolean);
		if (lines.length > 1) return `返回 ${lines.length} 条结果`;
	}
	if (result.length > 150) return result.slice(0, 150) + "...";
	return result;
}

function summarizeBashResult(result: string): string {
	const lines = result.trim().split("\n");
	if (lines.length <= 3) return lines.join("\n");
	return `...（共${lines.length}行）\n${lines.slice(-3).join("\n")}`;
}

export interface ToolEntry {
	toolName: string;
	status: "running" | "called" | "done" | "error";
	args?: Record<string, unknown>;
	result?: string;
	error?: string;
	startTime: number;
	duration?: number;
}

/**
 * Render all tool entries into a single markdown string for the tool info card.
 */
export function renderToolEntries(entries: ToolEntry[]): string {
	return entries.map(renderSingleEntry).join("\n\n");
}

function renderSingleEntry(entry: ToolEntry): string {
	const lines: string[] = [];

	// Status line
	const icon = entry.status === "error" ? "❌" : entry.status === "done" ? "✅" : "⚙️";
	let statusLine = `${icon} **${entry.toolName}**`;
	if (entry.duration != null && (entry.status === "done" || entry.status === "error")) {
		statusLine += `  ·  ${entry.duration}ms`;
	}
	lines.push(statusLine);

	// Args line
	if (entry.args && Object.keys(entry.args).length > 0) {
		lines.push(`> ${summarizeArgs(entry.args)}`);
	}

	// Result/error line (prefix each line with > for blockquote)
	if (entry.status === "done" && entry.result) {
		const summary = summarizeResult(entry.toolName, entry.result);
		lines.push(summary.split("\n").map((l) => `> ${l}`).join("\n"));
	} else if (entry.status === "error" && entry.error) {
		lines.push(`> 错误: ${entry.error}`);
	}

	return lines.join("\n");
}
