import { createLogger } from "@openmantis/common/logger";
import { tool } from "ai";
import { z } from "zod";

const logger = createLogger("core/tools");

const DEFAULT_HEAD_LIMIT = 250;
const GREP_TIMEOUT = 30_000;

type OutputMode = "files_with_matches" | "content" | "count";

function formatEmptyResult(outputMode: OutputMode) {
	if (outputMode === "files_with_matches") {
		return { files: [], total: 0, truncated: false };
	}
	if (outputMode === "content") {
		return { matches: "", total: 0, truncated: false };
	}
	return { counts: [], total: 0, truncated: false };
}

function formatGrepOutput(
	stdout: string,
	outputMode: OutputMode,
	offset: number,
	headLimit: number,
) {
	const lines = stdout.split("\n").filter((l) => l.length > 0);

	if (outputMode === "files_with_matches") {
		const total = lines.length;
		const sliced = headLimit === 0 ? lines.slice(offset) : lines.slice(offset, offset + headLimit);
		return {
			files: sliced,
			total,
			truncated: offset + sliced.length < total,
		};
	}

	if (outputMode === "content") {
		const total = lines.length;
		const sliced = headLimit === 0 ? lines.slice(offset) : lines.slice(offset, offset + headLimit);
		return {
			matches: sliced.join("\n"),
			total,
			truncated: offset + sliced.length < total,
		};
	}

	// count mode: lines are "file:count"
	const parsed = lines.map((line) => {
		const idx = line.lastIndexOf(":");
		const file = line.slice(0, idx);
		const count = Number.parseInt(line.slice(idx + 1), 10);
		return { file, count };
	});
	const total = parsed.length;
	const sliced = headLimit === 0 ? parsed.slice(offset) : parsed.slice(offset, offset + headLimit);
	return {
		counts: sliced,
		total,
		truncated: offset + sliced.length < total,
	};
}

export const SEARCH_TOOL_GUIDE = `## Search Tools Usage Guide

**Important:** Use file_search / content_search for all search tasks instead of bash commands (find/ls/grep/rg). These dedicated tools return structured results and are faster.

### file_search — Find files by name pattern
- Use when you need to find files, locate config files, list all files of a certain type, or understand project structure.
- Supports glob patterns: \`**/*.ts\`, \`src/**/*.{ts,tsx}\`, \`*.config.*\`.
- Results are sorted by modification time (most recent first), which helps find recently changed files.
- Use this tool instead of bash find/ls commands.

### content_search — Search file contents
- Use when you need to search code, find function definitions, locate variable references, find error messages, or search for specific strings.
- Built on ripgrep — supports full regex syntax (e.g., \`log.*Error\`, \`function\\s+\\w+\`).
- Pattern syntax uses ripgrep (not grep): literal braces need escaping (use \`interface\\{\\}\` to find \`interface{}\`).
- Output modes: "files_with_matches" (default, just file paths), "content" (matching lines with line numbers), "count" (match counts per file).
- Filter files with glob parameter (e.g., \`*.js\`) or type parameter (e.g., \`js\`, \`py\`, \`rust\`). Type filter is more efficient than glob for standard file types.
- Context lines: use context for symmetric context (-C), or context_before (-B) / context_after (-A) for asymmetric. context_before/context_after take priority over context when both are provided.
- Multiline matching: by default, patterns match within single lines only. For cross-line patterns like \`struct \\{[\\s\\S]*?field\`, use multiline: true.
- Pagination: use head_limit (default 250) and offset to page through large result sets. Pass head_limit: 0 for unlimited (use sparingly).
- Use this tool instead of bash grep/rg commands.`;

export function createSearchTools(cwd: string) {
	const globTool = tool({
		description:
			"Fast file pattern matching tool. Find files by name using glob patterns like '**/*.ts' or 'src/**/*.{ts,tsx}'. Returns matching file paths sorted by modification time (most recent first). Use this instead of bash find/ls.",
		inputSchema: z.object({
			pattern: z.string().describe("Glob pattern, e.g. **/*.ts"),
			path: z.string().optional().describe("Search directory. Defaults to working directory."),
			head_limit: z
				.number()
				.optional()
				.default(DEFAULT_HEAD_LIMIT)
				.describe("Max entries to return. 0 for unlimited."),
			offset: z.number().optional().default(0).describe("Skip first N entries."),
		}),
		execute: async ({ pattern, path, head_limit, offset }) => {
			const searchDir = path ?? cwd;
			const headLimit = head_limit ?? DEFAULT_HEAD_LIMIT;
			const skip = offset ?? 0;

			logger.debug(
				`[tool:glob] pattern=${pattern} dir=${searchDir} head_limit=${headLimit} offset=${skip}`,
			);

			try {
				const entries: Array<{ file: string; mtime: number }> = [];
				for await (const file of new Bun.Glob(pattern).scan({
					cwd: searchDir,
					onlyFiles: true,
				})) {
					try {
						const fullPath = `${searchDir}/${file}`;
						const mtime = Bun.file(fullPath).lastModified;
						entries.push({ file, mtime });
					} catch {
						entries.push({ file, mtime: 0 });
					}
				}

				entries.sort((a, b) => b.mtime - a.mtime);

				const files = entries.map((e) => e.file);
				const total = files.length;
				const sliced = headLimit === 0 ? files.slice(skip) : files.slice(skip, skip + headLimit);

				logger.debug(`[tool:glob] found ${total} files, returning ${sliced.length}`);

				return {
					files: sliced,
					total,
					truncated: skip + sliced.length < total,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.debug(`[tool:glob] error: ${message}`);
				return { error: message, files: [], total: 0, truncated: false };
			}
		},
	});

	const grepTool = tool({
		description:
			"Search file contents using regex patterns. Built on ripgrep for fast, structured results. Supports regex syntax, file type/glob filters, multiple output modes (files_with_matches, content, count), context lines, multiline matching, and pagination. Use this instead of bash grep/rg.",
		inputSchema: z.object({
			pattern: z.string().describe("Regex pattern to search for"),
			path: z
				.string()
				.optional()
				.describe("Search directory or file. Defaults to working directory."),
			glob: z.string().optional().describe("File name filter passed to rg --glob, e.g. *.ts"),
			type: z.string().optional().describe("File type filter passed to rg --type, e.g. js, py"),
			output_mode: z
				.enum(["files_with_matches", "content", "count"])
				.optional()
				.default("files_with_matches")
				.describe(
					"Output mode: files_with_matches (default), content (matching lines), count (match counts per file)",
				),
			context: z
				.number()
				.optional()
				.describe("Lines of context around matches (content mode only)"),
			context_before: z
				.number()
				.optional()
				.describe(
					"Lines to show before each match (rg -B), content mode only. Takes priority over context.",
				),
			context_after: z
				.number()
				.optional()
				.describe(
					"Lines to show after each match (rg -A), content mode only. Takes priority over context.",
				),
			case_insensitive: z
				.boolean()
				.optional()
				.default(false)
				.describe("Case-insensitive search (-i flag)"),
			multiline: z
				.boolean()
				.optional()
				.default(false)
				.describe("Multiline mode (-U --multiline-dotall)"),
			head_limit: z
				.number()
				.optional()
				.default(DEFAULT_HEAD_LIMIT)
				.describe("Max entries to return. 0 for unlimited."),
			offset: z.number().optional().default(0).describe("Skip first N entries."),
		}),
		execute: async ({
			pattern,
			path,
			glob: globFilter,
			type,
			output_mode,
			context: contextLines,
			context_before,
			context_after,
			case_insensitive,
			multiline,
			head_limit,
			offset,
		}) => {
			const searchPath = path ?? cwd;
			const outputMode: OutputMode = output_mode ?? "files_with_matches";
			const headLimit = head_limit ?? DEFAULT_HEAD_LIMIT;
			const skip = offset ?? 0;

			logger.debug(`[tool:grep] pattern=${pattern} path=${searchPath} mode=${outputMode}`);

			const args: string[] = [];

			if (outputMode === "files_with_matches") {
				args.push("--files-with-matches");
			} else if (outputMode === "content") {
				args.push("-n"); // line numbers
			} else if (outputMode === "count") {
				args.push("--count");
			}

			if (case_insensitive) {
				args.push("-i");
			}

			if (multiline) {
				args.push("-U", "--multiline-dotall");
			}

			if (outputMode === "content") {
				if (context_before !== undefined || context_after !== undefined) {
					if (context_before !== undefined) {
						args.push("-B", String(context_before));
					}
					if (context_after !== undefined) {
						args.push("-A", String(context_after));
					}
				} else if (contextLines !== undefined) {
					args.push("-C", String(contextLines));
				}
			}

			if (globFilter) {
				args.push("--glob", globFilter);
			}

			if (type) {
				args.push("--type", type);
			}

			args.push("--", pattern, searchPath);

			logger.debug(`[tool:grep] rg args: ${args.join(" ")}`);

			let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
			try {
				proc = Bun.spawn(["rg", ...args], {
					stdout: "pipe",
					stderr: "pipe",
					cwd,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (message.includes("ENOENT") || message.includes("No such file")) {
					return {
						error:
							"ripgrep (rg) is not installed. Please install it: https://github.com/BurntSushi/ripgrep#installation",
						...formatEmptyResult(outputMode),
					};
				}
				return { error: message, ...formatEmptyResult(outputMode) };
			}

			const timeoutHandle = setTimeout(() => {
				proc.kill();
			}, GREP_TIMEOUT);

			try {
				const [stdout, stderr, exitCode] = await Promise.all([
					new Response(proc.stdout).text(),
					new Response(proc.stderr).text(),
					proc.exited,
				]);

				clearTimeout(timeoutHandle);

				if (exitCode === 1) {
					// no matches
					logger.debug("[tool:grep] no matches found");
					return formatEmptyResult(outputMode);
				}

				if (exitCode === 2) {
					const errMsg = stderr.trim() || "ripgrep encountered an error";
					logger.warn(`[tool:grep] rg error: ${errMsg}`);
					return {
						error: errMsg,
						...formatEmptyResult(outputMode),
					};
				}

				const result = formatGrepOutput(stdout, outputMode, skip, headLimit);
				logger.debug(`[tool:grep] total=${result.total} truncated=${result.truncated}`);
				return result;
			} catch (err) {
				clearTimeout(timeoutHandle);
				const message = err instanceof Error ? err.message : String(err);
				logger.debug(`[tool:grep] error: ${message}`);
				return { error: message, ...formatEmptyResult(outputMode) };
			}
		},
	});

	return { file_search: globTool, content_search: grepTool };
}
