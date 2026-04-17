import { existsSync } from "node:fs";
import { createLogger } from "@openmantis/common/logger";
import { tool } from "ai";
import { z } from "zod";

const logger = createLogger("core/tools");

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const EDIT_CONTEXT_LINES = 5;
const FULL_CONTENT_LINE_THRESHOLD = 500;

export const FILE_TOOL_GUIDE = `## File Tools Usage Guide

**Important:** Use file_read / file_write / file_edit for all file operations instead of bash commands (cat/head/tail/echo/sed/awk). These dedicated tools return structured results and significantly reduce token usage.

### Efficiency principles

1. **Minimize tool calls.** When you need to make multiple changes to the same file, **always use batch mode** (edits array) instead of separate file_edit calls. This saves round trips and I/O.
2. **Trust the context snippet.** Every successful file_edit returns a context snippet showing lines around the edit point. Use it to verify the result and to construct the next edit's old_string — **do NOT file_read between consecutive edits** unless you truly need a different region of the file that isn't covered by prior reads or snippets.
3. **Plan all edits upfront.** After reading a file, identify all changes needed, then apply them in a single batch file_edit call. Do not read → edit → read → edit in a loop.

### file_read — Read files
- No need to check if a file exists before reading — just read it; the tool returns an error if not found.
- When you already know which part of the file you need, use offset/limit to read only that section. This saves tokens on large files.
- **Never re-read a range you already read in this session.** The tool tracks read ranges per file and will reject any request whose \`[offset, offset+limit)\` is fully covered by a prior read (unless the file was modified via file_write/file_edit since). Reuse the content from your earlier tool result instead of re-reading. If you need additional context around a match from content_search, pick an offset/limit that extends *beyond* what you previously read.
- After a successful file_edit or file_write, the read tracking is reset so a fresh read is allowed if truly needed — but in most cases the edit's **context snippet** is sufficient. Only re-read if you need to see a large portion of the updated file.
- Output format is \`lineNumber\\tcontact\` (line numbers start at 1). Note: the line number prefix is NOT part of the file content — do not include it when referencing text in file_edit.
- Lines longer than ${MAX_LINE_LENGTH} characters are clipped to \`…[truncated N chars]\`. If you need to file_edit such a line, use line range mode (start_line/end_line + new_content) instead of string matching — the clipped text won't match the file on disk.
- For Word-export HTML, XML with inline styles, minified JS/CSS, or other files with extremely long lines: prefer content_search (grep) to locate keywords first, then file_read a narrow offset/limit window around the match.

### file_write — Write files
- Use ONLY for **creating new files** or **complete rewrites**. To modify existing files, **prefer file_edit** — it only transmits the changed portion, saving tokens.
- Overwriting an existing file requires a prior file_read of that file, otherwise the write is rejected. This prevents blindly overwriting important content.
- Parent directories are created automatically if they don't exist.

### file_edit — Edit files
- Requires a prior file_read of the target file before editing.
- Every successful edit returns a **context snippet** (a few lines around the edit point) so you can verify the result without re-reading the file. Use this snippet to chain edits confidently.
- **Batch mode (preferred for multiple changes):** provide an \`edits\` array of \`{old_string, new_string, replace_all?}\` objects.
  - **Always prefer batch mode when you have 2+ changes to the same file.** Collect all intended edits and submit them in one call.
  - All edits are applied sequentially in one call — each edit sees the result of previous ones. So you can first rename a type and later edits can reference the new name.
  - Single read + single write, much more efficient than multiple separate calls.
  - Each edit in the batch returns its own context snippet and success/error status.
  - If some edits fail, the successful ones are still applied. Check the \`results\` array.
- **String replacement mode** (single edit): provide old_string + new_string.
  - old_string must **exactly match** the text in the file, including indentation (tabs/spaces) and newlines.
  - When copying text from file_read output, **do NOT include the line number prefix** — only use the actual content after the tab.
  - By default, old_string must be unique in the file. If not unique, include more surrounding context (a few extra lines) to make it unique, or use replace_all: true to replace all occurrences.
  - Good for: renaming variables (replace_all), modifying function implementations, fixing bugs, adding/removing code sections.
- **Line range mode** (single edit): provide start_line + end_line + new_content.
  - Line numbers are 1-based; end_line is inclusive.
  - Good for: replacing large contiguous blocks, inserting content at a precise location.
  - Note: if prior edits changed the line count, line numbers may have shifted — re-read with file_read to confirm.`;

type ReadRange = { start: number; end: number };

function isRangeCovered(ranges: ReadRange[], start: number, end: number): boolean {
	return ranges.some((r) => start >= r.start && end <= r.end);
}

/**
 * Returns a numbered snippet of lines around `centerLine` (0-based) for edit confirmation.
 */
function editContextSnippet(allLines: string[], centerLine: number): string {
	const start = Math.max(0, centerLine - EDIT_CONTEXT_LINES);
	const end = Math.min(allLines.length, centerLine + EDIT_CONTEXT_LINES + 1);
	return allLines
		.slice(start, end)
		.map((line, i) => `${start + i + 1}\t${line}`)
		.join("\n");
}

function formatFullContent(allLines: string[]): string {
	return allLines.map((line, i) => `${i + 1}\t${line}`).join("\n");
}

type EditType = "string_replace" | "insert_after" | "insert_before" | "delete" | "line_range";

interface EditResult {
	success: boolean;
	content?: string;
	replacements?: number;
	centerLine?: number;
	error?: string;
}

function countOccurrences(content: string, search: string): number {
	let count = 0;
	let from = 0;
	while (true) {
		const idx = content.indexOf(search, from);
		if (idx === -1) break;
		count++;
		from = idx + search.length;
	}
	return count;
}

function applyStringReplace(
	content: string,
	oldStr: string,
	newStr: string,
	replaceAll: boolean,
): EditResult {
	const count = countOccurrences(content, oldStr);
	if (count === 0) {
		return {
			success: false,
			error: `old_string not found: ${oldStr.slice(0, 80)}${oldStr.length > 80 ? "..." : ""}`,
		};
	}
	if (!replaceAll && count > 1) {
		return {
			success: false,
			error: `old_string found ${count} times (not unique). Add context or set replace_all: true.`,
		};
	}

	let newContent: string;
	if (replaceAll) {
		newContent = content.replaceAll(oldStr, newStr);
	} else {
		const idx = content.indexOf(oldStr);
		newContent = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
	}

	const editIdx = newContent.indexOf(newStr);
	const centerLine =
		editIdx >= 0
			? newContent.slice(0, editIdx + Math.floor(newStr.length / 2)).split("\n").length - 1
			: 0;

	return {
		success: true,
		content: newContent,
		replacements: replaceAll ? count : 1,
		centerLine,
	};
}

function applyInsertAfter(
	content: string,
	anchor: string,
	insertContent: string,
	replaceAll: boolean,
): EditResult {
	const count = countOccurrences(content, anchor);
	if (count === 0) {
		return {
			success: false,
			error: `anchor not found: ${anchor.slice(0, 80)}${anchor.length > 80 ? "..." : ""}`,
		};
	}
	if (!replaceAll && count > 1) {
		return {
			success: false,
			error: `anchor found ${count} times (not unique). Add context or set replace_all: true.`,
		};
	}

	const separator = anchor.endsWith("\n") || insertContent.startsWith("\n") ? "" : "\n";
	const replacement = anchor + separator + insertContent;

	let newContent: string;
	if (replaceAll) {
		newContent = content.replaceAll(anchor, replacement);
	} else {
		const idx = content.indexOf(anchor);
		newContent = content.slice(0, idx) + replacement + content.slice(idx + anchor.length);
	}

	const editIdx = newContent.indexOf(replacement);
	const centerLine =
		editIdx >= 0
			? newContent.slice(0, editIdx + Math.floor(replacement.length / 2)).split("\n").length - 1
			: 0;

	return {
		success: true,
		content: newContent,
		replacements: replaceAll ? count : 1,
		centerLine,
	};
}

function applyInsertBefore(
	content: string,
	anchor: string,
	insertContent: string,
	replaceAll: boolean,
): EditResult {
	const count = countOccurrences(content, anchor);
	if (count === 0) {
		return {
			success: false,
			error: `anchor not found: ${anchor.slice(0, 80)}${anchor.length > 80 ? "..." : ""}`,
		};
	}
	if (!replaceAll && count > 1) {
		return {
			success: false,
			error: `anchor found ${count} times (not unique). Add context or set replace_all: true.`,
		};
	}

	const separator = insertContent.endsWith("\n") || anchor.startsWith("\n") ? "" : "\n";
	const replacement = insertContent + separator + anchor;

	let newContent: string;
	if (replaceAll) {
		newContent = content.replaceAll(anchor, replacement);
	} else {
		const idx = content.indexOf(anchor);
		newContent = content.slice(0, idx) + replacement + content.slice(idx + anchor.length);
	}

	const editIdx = newContent.indexOf(replacement);
	const centerLine =
		editIdx >= 0
			? newContent.slice(0, editIdx + Math.floor(replacement.length / 2)).split("\n").length - 1
			: 0;

	return {
		success: true,
		content: newContent,
		replacements: replaceAll ? count : 1,
		centerLine,
	};
}

function applyDelete(content: string, target: string, replaceAll: boolean): EditResult {
	const count = countOccurrences(content, target);
	if (count === 0) {
		return {
			success: false,
			error: `target not found: ${target.slice(0, 80)}${target.length > 80 ? "..." : ""}`,
		};
	}
	if (!replaceAll && count > 1) {
		return {
			success: false,
			error: `target found ${count} times (not unique). Add context or set replace_all: true.`,
		};
	}

	// Compute centerLine at first occurrence before deletion
	const firstIdx = content.indexOf(target);
	const centerLine = content.slice(0, firstIdx).split("\n").length - 1;

	let newContent: string;
	if (replaceAll) {
		newContent = content.replaceAll(target, "");
	} else {
		newContent = content.slice(0, firstIdx) + content.slice(firstIdx + target.length);
	}

	return {
		success: true,
		content: newContent,
		replacements: replaceAll ? count : 1,
		centerLine,
	};
}

function detectEditType(edit: Record<string, unknown>): EditType | null {
	if ("old_string" in edit && "new_string" in edit) return "string_replace";
	if ("insert_after" in edit && "content" in edit) return "insert_after";
	if ("insert_before" in edit && "content" in edit) return "insert_before";
	if ("delete" in edit) return "delete";
	if ("start_line" in edit && "end_line" in edit) return "line_range";
	return null;
}

export function createFileTools() {
	// Tracks which line ranges (0-based, end-exclusive) have been read per file.
	// Reset when the file is written or edited so post-modification reads are allowed.
	const fileReads = new Map<string, ReadRange[]>();
	const fileRead = tool({
		description:
			"Read file contents. Supports partial reading of large files via offset and limit parameters to save tokens. Output format: line numbers starting from 1. Use this tool instead of bash cat/head/tail.",
		inputSchema: z.object({
			file_path: z.string().describe("Absolute path to the file"),
			offset: z.number().optional().default(0).describe("Start line (0-based), defaults to 0"),
			limit: z
				.number()
				.optional()
				.default(DEFAULT_READ_LIMIT)
				.describe(`Number of lines to read, defaults to ${DEFAULT_READ_LIMIT}`),
		}),
		execute: async ({ file_path, offset, limit }) => {
			logger.debug(`[tool:file_read] path=${file_path} offset=${offset} limit=${limit}`);

			if (!existsSync(file_path)) {
				return { error: `File not found: ${file_path}` };
			}

			try {
				const content = await Bun.file(file_path).text();
				const allLines = content.split("\n");
				const totalLines = allLines.length;
				const startLine = Math.max(0, offset ?? 0);
				const readLimit = limit ?? DEFAULT_READ_LIMIT;
				const endLine = Math.min(startLine + readLimit, totalLines);

				const priorRanges = fileReads.get(file_path) ?? [];
				if (isRangeCovered(priorRanges, startLine, endLine)) {
					logger.debug(
						`[tool:file_read] redundant read blocked: ${file_path} [${startLine}, ${endLine}) already covered`,
					);
					return {
						error: `Lines ${startLine + 1}-${endLine} of ${file_path} have already been read in this session and the file has not been modified since. Reuse the content from your previous tool result instead of re-reading. If you need a different section, use a non-overlapping offset/limit.`,
						alreadyReadRanges: priorRanges.map((r) => ({
							startLine: r.start + 1,
							endLine: r.end,
						})),
					};
				}

				const sliced = allLines.slice(startLine, endLine);

				let truncatedLineCount = 0;
				const clipped = sliced.map((line) => {
					if (line.length > MAX_LINE_LENGTH) {
						truncatedLineCount++;
						return `${line.slice(0, MAX_LINE_LENGTH)}…[truncated ${line.length - MAX_LINE_LENGTH} chars]`;
					}
					return line;
				});

				const numbered = clipped.map((line, i) => `${startLine + i + 1}\t${line}`).join("\n");

				fileReads.set(file_path, [...priorRanges, { start: startLine, end: endLine }]);

				logger.debug(
					`[tool:file_read] read ${sliced.length}/${totalLines} lines from ${file_path}${truncatedLineCount ? ` (${truncatedLineCount} long lines clipped)` : ""}`,
				);

				return {
					content: numbered,
					totalLines,
					readLines: sliced.length,
					truncated: startLine + sliced.length < totalLines,
					...(truncatedLineCount > 0 && { truncatedLines: truncatedLineCount }),
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.debug(`[tool:file_read] error: ${message}`);
				return { error: message };
			}
		},
	});

	const fileWrite = tool({
		description:
			"Create a new file or overwrite an existing file. If the file already exists, it must have been read via file_read first. Parent directories are created automatically. Use this tool instead of bash echo/cat redirection.",
		inputSchema: z.object({
			file_path: z.string().describe("Absolute path to the file"),
			content: z.string().describe("Complete file content to write"),
		}),
		execute: async ({ file_path, content }) => {
			logger.debug(`[tool:file_write] path=${file_path} contentLen=${content.length}`);

			// Safety gate: if file exists, must have been read first
			if (existsSync(file_path) && !fileReads.has(file_path)) {
				return {
					error: `File exists but has not been read. Please use file_read to read ${file_path} before writing.`,
				};
			}

			try {
				// Ensure parent directory exists
				const dir = file_path.slice(0, file_path.lastIndexOf("/"));
				if (dir && !existsSync(dir)) {
					await Bun.$`mkdir -p ${dir}`.quiet();
				}

				await Bun.write(file_path, content);
				const lines = content.split("\n").length;
				// Post-write: clear prior read ranges so fresh reads are allowed,
				// but keep the map entry so the "must read before edit" safety gate passes.
				fileReads.set(file_path, []);

				logger.debug(`[tool:file_write] wrote ${lines} lines to ${file_path}`);

				return { success: true, path: file_path, lines };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.debug(`[tool:file_write] error: ${message}`);
				return { error: message };
			}
		},
	});

	const fileEdit = tool({
		description:
			"Edit one or more files in a single call. Supports multi-file batch edits with multiple edit primitives.\n\nProvide a `files` array where each entry has a `path` and an `edits` array. Edit types:\n1. **String replace**: `{ old_string, new_string, replace_all? }`\n2. **Insert after**: `{ insert_after, content, replace_all? }` — insert content after anchor text\n3. **Insert before**: `{ insert_before, content, replace_all? }` — insert content before anchor text\n4. **Delete**: `{ delete, replace_all? }` — remove target text\n5. **Line range**: `{ start_line, end_line, new_content }` — replace line range (must be the only edit for that file)\n\nEdits are applied sequentially per file. All files must have been read via file_read first. Files ≤ 500 lines return full content after edit; larger files return context snippets.",
		inputSchema: z.object({
			files: z.array(
				z.object({
					path: z.string().describe("Absolute path to the file"),
					edits: z.array(
						z.union([
							z.object({
								old_string: z.string().describe("Text to find and replace"),
								new_string: z.string().describe("Replacement text"),
								replace_all: z
									.boolean()
									.optional()
									.default(false)
									.describe("Replace all occurrences"),
							}),
							z.object({
								insert_after: z.string().describe("Anchor text to insert after"),
								content: z.string().describe("Content to insert after the anchor"),
								replace_all: z
									.boolean()
									.optional()
									.default(false)
									.describe("Apply at all occurrences of the anchor"),
							}),
							z.object({
								insert_before: z.string().describe("Anchor text to insert before"),
								content: z.string().describe("Content to insert before the anchor"),
								replace_all: z
									.boolean()
									.optional()
									.default(false)
									.describe("Apply at all occurrences of the anchor"),
							}),
							z.object({
								delete: z.string().describe("Text to delete"),
								replace_all: z
									.boolean()
									.optional()
									.default(false)
									.describe("Delete all occurrences"),
							}),
							z.object({
								start_line: z.number().describe("Start line number, 1-based (line range mode)"),
								end_line: z
									.number()
									.describe("End line number, 1-based, inclusive (line range mode)"),
								new_content: z.string().describe("New content to replace the line range"),
							}),
						]),
					),
				}),
			),
		}),
		execute: async ({ files }) => {
			logger.debug(`[tool:file_edit] editing ${files.length} file(s)`);

			// Pre-flight: check all files have been read and exist
			const preflightErrors: string[] = [];
			for (const f of files) {
				if (!fileReads.has(f.path)) {
					preflightErrors.push(`File has not been read: ${f.path}. Use file_read first.`);
				} else if (!existsSync(f.path)) {
					preflightErrors.push(`File not found: ${f.path}`);
				}
			}
			if (preflightErrors.length > 0) {
				return { success: false, errors: preflightErrors };
			}

			const fileResults: Array<{
				path: string;
				success: boolean;
				applied: number;
				failed: number;
				results: Array<{
					index: number;
					success: boolean;
					replacements?: number;
					context?: string;
					error?: string;
				}>;
				fullContent?: string;
			}> = [];

			for (const f of files) {
				try {
					let content = await Bun.file(f.path).text();
					const editResults: Array<{
						index: number;
						success: boolean;
						replacements?: number;
						context?: string;
						error?: string;
					}> = [];

					// Check for line_range mixing: if any edit is line_range and there are multiple edits, error
					const hasLineRange = f.edits.some((e) => {
						const rec = e as Record<string, unknown>;
						return "start_line" in rec && "end_line" in rec;
					});
					if (hasLineRange && f.edits.length > 1) {
						fileResults.push({
							path: f.path,
							success: false,
							applied: 0,
							failed: f.edits.length,
							results: [
								{
									index: 0,
									success: false,
									error:
										"line_range edits cannot be mixed with other edits. Use a separate file entry for line_range.",
								},
							],
						});
						continue;
					}

					for (let i = 0; i < f.edits.length; i++) {
						const edit = f.edits[i] as Record<string, unknown>;
						const editType = detectEditType(edit);

						if (!editType) {
							editResults.push({
								index: i,
								success: false,
								error:
									"Unknown edit type. Provide one of: old_string+new_string, insert_after+content, insert_before+content, delete, or start_line+end_line+new_content.",
							});
							continue;
						}

						let result: EditResult;

						switch (editType) {
							case "string_replace": {
								const oldStr = edit.old_string as string;
								const newStr = edit.new_string as string;
								if (oldStr === newStr) {
									editResults.push({
										index: i,
										success: false,
										error: "old_string and new_string must be different.",
									});
									continue;
								}
								result = applyStringReplace(
									content,
									oldStr,
									newStr,
									(edit.replace_all as boolean) ?? false,
								);
								break;
							}
							case "insert_after": {
								result = applyInsertAfter(
									content,
									edit.insert_after as string,
									edit.content as string,
									(edit.replace_all as boolean) ?? false,
								);
								break;
							}
							case "insert_before": {
								result = applyInsertBefore(
									content,
									edit.insert_before as string,
									edit.content as string,
									(edit.replace_all as boolean) ?? false,
								);
								break;
							}
							case "delete": {
								result = applyDelete(
									content,
									edit.delete as string,
									(edit.replace_all as boolean) ?? false,
								);
								break;
							}
							case "line_range": {
								const startLine = edit.start_line as number;
								const endLine = edit.end_line as number;
								const newContent = edit.new_content as string;
								const lines = content.split("\n");
								const totalLines = lines.length;

								if (startLine < 1 || startLine > totalLines) {
									editResults.push({
										index: i,
										success: false,
										error: `start_line ${startLine} out of range (file has ${totalLines} lines).`,
									});
									continue;
								}
								if (endLine < startLine || endLine > totalLines) {
									editResults.push({
										index: i,
										success: false,
										error: `end_line ${endLine} invalid (start_line=${startLine}, file has ${totalLines} lines).`,
									});
									continue;
								}

								const before = lines.slice(0, startLine - 1);
								const after = lines.slice(endLine);
								const newLines = newContent.split("\n");
								const resultLines = [...before, ...newLines, ...after];
								const centerLine = before.length + Math.floor(newLines.length / 2);

								result = {
									success: true,
									content: resultLines.join("\n"),
									replacements: 1,
									centerLine,
								};
								break;
							}
						}

						if (result.success && result.content) {
							content = result.content;
							const allLines = content.split("\n");
							editResults.push({
								index: i,
								success: true,
								replacements: result.replacements,
								context: editContextSnippet(allLines, result.centerLine ?? 0),
							});
						} else {
							editResults.push({
								index: i,
								success: false,
								error: result.error,
							});
						}
					}

					const successCount = editResults.filter((r) => r.success).length;
					if (successCount > 0) {
						await Bun.write(f.path, content);
						fileReads.set(f.path, []);
					}

					const allLines = content.split("\n");
					const fileResult: (typeof fileResults)[number] = {
						path: f.path,
						success: successCount > 0,
						applied: successCount,
						failed: f.edits.length - successCount,
						results: editResults,
					};

					if (successCount > 0 && allLines.length <= FULL_CONTENT_LINE_THRESHOLD) {
						fileResult.fullContent = formatFullContent(allLines);
					}

					fileResults.push(fileResult);

					logger.debug(
						`[tool:file_edit] ${f.path}: ${successCount}/${f.edits.length} edits applied`,
					);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					logger.debug(`[tool:file_edit] error on ${f.path}: ${message}`);
					fileResults.push({
						path: f.path,
						success: false,
						applied: 0,
						failed: f.edits.length,
						results: [{ index: 0, success: false, error: message }],
					});
				}
			}

			const overallSuccess = fileResults.some((f) => f.success);
			return { success: overallSuccess, files: fileResults };
		},
	});

	return { file_read: fileRead, file_write: fileWrite, file_edit: fileEdit };
}
