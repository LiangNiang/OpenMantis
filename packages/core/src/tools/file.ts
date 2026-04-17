import { existsSync } from "node:fs";
import { createLogger } from "@openmantis/common/logger";
import { tool } from "ai";
import { z } from "zod";

const logger = createLogger("core/tools");

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const EDIT_CONTEXT_LINES = 5;
const _FULL_CONTENT_LINE_THRESHOLD = 500;

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

function _formatFullContent(allLines: string[]): string {
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

function _applyStringReplace(
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

function _applyInsertAfter(
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

function _applyInsertBefore(
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

function _applyDelete(content: string, target: string, replaceAll: boolean): EditResult {
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

function _detectEditType(edit: Record<string, unknown>): EditType | null {
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
			"Edit file contents partially, avoiding full rewrites. Supports single or batch edits.\n\n**Single edit** (use top-level parameters):\n1. **String replacement**: provide old_string + new_string. old_string must be unique (unless replace_all: true).\n2. **Line range replacement**: provide start_line + end_line + new_content.\n\n**Batch edit** (use edits array): provide an array of {old_string, new_string, replace_all?} objects to apply multiple string replacements in one call. Edits are applied sequentially — each edit sees the result of previous ones. Do not mix batch with single-edit parameters.\n\nFile must have been read via file_read first. Returns a context snippet around each edit point for verification.",
		inputSchema: z.object({
			file_path: z.string().describe("Absolute path to the file"),
			// String replacement mode
			old_string: z.string().optional().describe("Text to replace (string replacement mode)"),
			new_string: z.string().optional().describe("Replacement text (string replacement mode)"),
			replace_all: z
				.boolean()
				.optional()
				.default(false)
				.describe("Replace all occurrences, defaults to false (string replacement mode)"),
			// Line range mode
			start_line: z.number().optional().describe("Start line number, 1-based (line range mode)"),
			end_line: z
				.number()
				.optional()
				.describe("End line number, 1-based, inclusive (line range mode)"),
			new_content: z
				.string()
				.optional()
				.describe("New content to replace the line range (line range mode)"),
			// Batch mode
			edits: z
				.array(
					z.object({
						old_string: z.string().describe("Text to replace"),
						new_string: z.string().describe("Replacement text"),
						replace_all: z.boolean().optional().default(false).describe("Replace all occurrences"),
					}),
				)
				.optional()
				.describe(
					"Array of string replacements to apply sequentially in one call. Cannot be mixed with single-edit parameters.",
				),
		}),
		execute: async ({
			file_path,
			old_string,
			new_string,
			replace_all,
			start_line,
			end_line,
			new_content,
			edits,
		}) => {
			logger.debug(`[tool:file_edit] path=${file_path}`);

			// Safety gate: must have been read first
			if (!fileReads.has(file_path)) {
				return {
					error: `File has not been read. Please use file_read to read ${file_path} before editing.`,
				};
			}

			if (!existsSync(file_path)) {
				return { error: `File not found: ${file_path}` };
			}

			// Determine mode
			const hasStringMode = old_string !== undefined;
			const hasLineMode = start_line !== undefined || end_line !== undefined;
			const hasBatchMode = edits !== undefined && edits.length > 0;

			const modeCount = [hasStringMode, hasLineMode, hasBatchMode].filter(Boolean).length;
			if (modeCount > 1) {
				return {
					error:
						"Cannot mix edit modes. Use exactly one of: (1) old_string + new_string, (2) start_line + end_line + new_content, (3) edits array.",
				};
			}
			if (modeCount === 0) {
				return {
					error:
						"Provide old_string + new_string (string replacement), start_line + end_line + new_content (line range), or edits array (batch).",
				};
			}

			try {
				let content = await Bun.file(file_path).text();

				// --- Batch mode ---
				if (hasBatchMode) {
					const results: Array<{
						index: number;
						success: boolean;
						replacements?: number;
						context?: string;
						error?: string;
					}> = [];

					for (let i = 0; i < edits.length; i++) {
						const edit = edits[i]!;
						if (edit.old_string === edit.new_string) {
							results.push({
								index: i,
								success: false,
								error: "old_string and new_string must be different.",
							});
							continue;
						}

						let count = 0;
						let searchFrom = 0;
						while (true) {
							const idx = content.indexOf(edit.old_string, searchFrom);
							if (idx === -1) break;
							count++;
							searchFrom = idx + edit.old_string.length;
						}

						if (count === 0) {
							results.push({
								index: i,
								success: false,
								error: `old_string not found: ${edit.old_string.slice(0, 80)}${edit.old_string.length > 80 ? "..." : ""}`,
							});
							continue;
						}

						if (!edit.replace_all && count > 1) {
							results.push({
								index: i,
								success: false,
								error: `old_string found ${count} times (not unique). Add context or set replace_all: true.`,
							});
							continue;
						}

						if (edit.replace_all) {
							content = content.replaceAll(edit.old_string, edit.new_string);
						} else {
							const idx = content.indexOf(edit.old_string);
							content =
								content.slice(0, idx) +
								edit.new_string +
								content.slice(idx + edit.old_string.length);
						}

						// Compute context snippet around first replacement
						const newLines = content.split("\n");
						const editIdx = content.indexOf(edit.new_string);
						const centerLine =
							editIdx >= 0
								? content.slice(0, editIdx + edit.new_string.length / 2).split("\n").length - 1
								: 0;

						results.push({
							index: i,
							success: true,
							replacements: edit.replace_all ? count : 1,
							context: editContextSnippet(newLines, centerLine),
						});
					}

					const successCount = results.filter((r) => r.success).length;
					if (successCount > 0) {
						await Bun.write(file_path, content);
						fileReads.set(file_path, []);
					}

					logger.debug(
						`[tool:file_edit] batch: ${successCount}/${edits.length} edits applied in ${file_path}`,
					);

					return {
						success: successCount > 0,
						mode: "batch",
						totalEdits: edits.length,
						applied: successCount,
						failed: edits.length - successCount,
						results,
					};
				}

				// --- Single string replacement mode ---
				if (hasStringMode) {
					if (new_string === undefined) {
						return {
							error: "String replacement mode requires both old_string and new_string.",
						};
					}
					if (old_string === new_string) {
						return { error: "old_string and new_string must be different." };
					}

					let count = 0;
					let searchFrom = 0;
					while (true) {
						const idx = content.indexOf(old_string!, searchFrom);
						if (idx === -1) break;
						count++;
						searchFrom = idx + old_string!.length;
					}

					if (count === 0) {
						return {
							error:
								"old_string not found in file. Check that the text matches exactly (including whitespace and indentation).",
						};
					}

					if (!replace_all && count > 1) {
						return {
							error: `old_string found ${count} times in file (not unique). Include more surrounding context to make it unique, or set replace_all: true to replace all occurrences.`,
						};
					}

					let newContent: string;
					if (replace_all) {
						newContent = content.replaceAll(old_string!, new_string);
					} else {
						const idx = content.indexOf(old_string!);
						newContent =
							content.slice(0, idx) + new_string + content.slice(idx + old_string!.length);
					}

					await Bun.write(file_path, newContent);
					fileReads.set(file_path, []);

					// Generate context snippet around the edit point
					const newLines = newContent.split("\n");
					const editIdx = newContent.indexOf(new_string);
					const centerLine =
						editIdx >= 0
							? newContent.slice(0, editIdx + new_string.length / 2).split("\n").length - 1
							: 0;

					logger.debug(`[tool:file_edit] string replace: ${count} occurrence(s) in ${file_path}`);

					return {
						success: true,
						replacements: replace_all ? count : 1,
						mode: "string_replace",
						context: editContextSnippet(newLines, centerLine),
					};
				}

				// --- Line range mode ---
				if (start_line === undefined || end_line === undefined) {
					return {
						error: "Line range mode requires both start_line and end_line.",
					};
				}
				if (new_content === undefined) {
					return { error: "Line range mode requires new_content." };
				}

				const lines = content.split("\n");
				const totalLines = lines.length;

				if (start_line < 1 || start_line > totalLines) {
					return {
						error: `start_line ${start_line} out of range (file has ${totalLines} lines).`,
					};
				}
				if (end_line < start_line || end_line > totalLines) {
					return {
						error: `end_line ${end_line} invalid (start_line=${start_line}, file has ${totalLines} lines).`,
					};
				}

				const before = lines.slice(0, start_line - 1);
				const after = lines.slice(end_line);
				const newLines = new_content.split("\n");
				const result = [...before, ...newLines, ...after];

				await Bun.write(file_path, result.join("\n"));
				fileReads.set(file_path, []);

				const removedCount = end_line - start_line + 1;
				// Context around the middle of the inserted block
				const centerLine = before.length + Math.floor(newLines.length / 2);

				logger.debug(
					`[tool:file_edit] line range: replaced lines ${start_line}-${end_line} (${removedCount} -> ${newLines.length}) in ${file_path}`,
				);

				return {
					success: true,
					mode: "line_range",
					removedLines: removedCount,
					insertedLines: newLines.length,
					context: editContextSnippet(result, centerLine),
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.debug(`[tool:file_edit] error: ${message}`);
				return { error: message };
			}
		},
	});

	return { file_read: fileRead, file_write: fileWrite, file_edit: fileEdit };
}
