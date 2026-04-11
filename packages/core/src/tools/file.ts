import { existsSync } from "node:fs";
import { createLogger } from "@openmantis/common/logger";
import { tool } from "ai";
import { z } from "zod";

const logger = createLogger("core/tools");

const DEFAULT_READ_LIMIT = 2000;

export const FILE_TOOL_GUIDE = `## File Tools Usage Guide

**Important:** Use file_read / file_write / file_edit for all file operations instead of bash commands (cat/head/tail/echo/sed/awk). These dedicated tools return structured results and significantly reduce token usage.

### file_read — Read files
- No need to check if a file exists before reading — just read it; the tool returns an error if not found.
- When you already know which part of the file you need, use offset/limit to read only that section. This saves tokens on large files.
- Do NOT re-read a file you just modified via file_write or file_edit to verify — if the write/edit didn't error, the content is correct.
- Output format is \`lineNumber\\tcontact\` (line numbers start at 1). Note: the line number prefix is NOT part of the file content — do not include it when referencing text in file_edit.

### file_write — Write files
- Use ONLY for **creating new files** or **complete rewrites**. To modify existing files, **prefer file_edit** — it only transmits the changed portion, saving tokens.
- Overwriting an existing file requires a prior file_read of that file, otherwise the write is rejected. This prevents blindly overwriting important content.
- Parent directories are created automatically if they don't exist.

### file_edit — Edit files
- Requires a prior file_read of the target file before editing.
- **String replacement mode** (recommended): provide old_string + new_string.
  - old_string must **exactly match** the text in the file, including indentation (tabs/spaces) and newlines.
  - When copying text from file_read output, **do NOT include the line number prefix** — only use the actual content after the tab.
  - By default, old_string must be unique in the file. If not unique, include more surrounding context (a few extra lines) to make it unique, or use replace_all: true to replace all occurrences.
  - Good for: renaming variables (replace_all), modifying function implementations, fixing bugs, adding/removing code sections.
- **Line range mode**: provide start_line + end_line + new_content.
  - Line numbers are 1-based; end_line is inclusive.
  - Good for: replacing large contiguous blocks, inserting content at a precise location.
  - Note: if prior edits changed the line count, line numbers may have shifted — re-read with file_read to confirm.`;

export function createFileTools() {
	const readFiles = new Set<string>();
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
				const sliced = allLines.slice(startLine, startLine + readLimit);

				const numbered = sliced.map((line, i) => `${startLine + i + 1}\t${line}`).join("\n");

				readFiles.add(file_path);

				logger.debug(
					`[tool:file_read] read ${sliced.length}/${totalLines} lines from ${file_path}`,
				);

				return {
					content: numbered,
					totalLines,
					readLines: sliced.length,
					truncated: startLine + sliced.length < totalLines,
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
			if (existsSync(file_path) && !readFiles.has(file_path)) {
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
				readFiles.add(file_path);

				const lines = content.split("\n").length;
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
			"Edit file contents partially, avoiding full rewrites. Two mutually exclusive modes:\n1. **String replacement**: provide old_string + new_string to precisely replace text. old_string must be unique by default (unless replace_all: true).\n2. **Line range replacement**: provide start_line + end_line + new_content to replace a line range.\nDo not mix parameters from both modes. File must have been read via file_read first.",
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
		}),
		execute: async ({
			file_path,
			old_string,
			new_string,
			replace_all,
			start_line,
			end_line,
			new_content,
		}) => {
			logger.debug(`[tool:file_edit] path=${file_path}`);

			// Safety gate: must have been read first
			if (!readFiles.has(file_path)) {
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

			if (hasStringMode && hasLineMode) {
				return {
					error:
						"Cannot use both string replacement and line range modes. Provide only one set of parameters.",
				};
			}

			if (!hasStringMode && !hasLineMode) {
				return {
					error:
						"Provide old_string + new_string (string replacement mode) or start_line + end_line + new_content (line range mode).",
				};
			}

			try {
				const content = await Bun.file(file_path).text();

				if (hasStringMode) {
					// String replacement mode
					if (new_string === undefined) {
						return {
							error: "String replacement mode requires both old_string and new_string.",
						};
					}
					if (old_string === new_string) {
						return { error: "old_string and new_string must be different." };
					}

					// Count occurrences
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

					logger.debug(`[tool:file_edit] string replace: ${count} occurrence(s) in ${file_path}`);

					return {
						success: true,
						replacements: replace_all ? count : 1,
						mode: "string_replace",
					};
				}

				// Line range mode
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

				const removedCount = end_line - start_line + 1;
				logger.debug(
					`[tool:file_edit] line range: replaced lines ${start_line}-${end_line} (${removedCount} -> ${newLines.length}) in ${file_path}`,
				);

				return {
					success: true,
					mode: "line_range",
					removedLines: removedCount,
					insertedLines: newLines.length,
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
