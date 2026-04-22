import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenMantisConfig } from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import { browserProfileDir, WORKSPACE_DIR } from "@openmantis/common/paths";
import { type Tool, tool } from "ai";
import { z } from "zod";

const logger = createLogger("core/tools/browser");

const MAX_TIMEOUT = 600_000;
const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_MAX_OUTPUT = 100_000;
const MAX_OUTPUT_LIMIT = 1_000_000;
const HELP_TIMEOUT = 30_000;
const LRU_KEEP = 50;
const MANAGED_FLAGS = new Set(["--session", "--profile", "--cdp", "--auto-connect"]);

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape matching
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[[?]?[0-9;]*[a-zA-Z]/g;

interface BrowserSession {
	proc: ReturnType<typeof Bun.spawn>;
	startedAt: number;
}

const sessions = new Map<string, BrowserSession>();

function stripAnsi(text: string): string {
	return text.replace(ANSI_REGEX, "");
}

function truncateOutput(output: string, maxLength: number): string {
	if (output.length <= maxLength) return output;
	const halfLimit = Math.floor(maxLength / 2);
	const head = output.slice(0, halfLimit);
	const tail = output.slice(-halfLimit);
	const removed = output.length - maxLength;
	return `${head}\n\n[... truncated ${removed} characters; see outputFile for full content ...]\n\n${tail}`;
}

function detectManagedFlag(args: string[]): string | null {
	for (const a of args) {
		if (MANAGED_FLAGS.has(a)) return a;
	}
	return null;
}

function buildAutoFlags(config: OpenMantisConfig, routeId: string): string[] {
	const cdp = config.browser?.cdp;
	if (cdp?.autoConnect === true) {
		return ["--auto-connect", "--session", `route-${routeId}`];
	}
	if (typeof cdp?.port === "number") {
		return ["--cdp", String(cdp.port), "--session", `route-${routeId}`];
	}
	return ["--session", `route-${routeId}`, "--profile", browserProfileDir(routeId)];
}

async function pruneOutputDir(dir: string, keep: number): Promise<void> {
	try {
		const entries = await readdir(dir);
		if (entries.length <= keep) return;
		const stats = await Promise.all(
			entries.map(async (name) => {
				const full = path.join(dir, name);
				try {
					const s = await stat(full);
					return { name, full, mtimeMs: s.mtimeMs };
				} catch {
					return null;
				}
			}),
		);
		const valid = stats.filter((s): s is NonNullable<typeof s> => s !== null);
		valid.sort((a, b) => b.mtimeMs - a.mtimeMs);
		for (const old of valid.slice(keep)) {
			try {
				await unlink(old.full);
			} catch (err) {
				logger.warn(`[browser] prune failed for ${old.full}: ${err}`);
			}
		}
	} catch (err) {
		logger.warn(`[browser] prune dir ${dir} failed: ${err}`);
	}
}

async function spillToFile(
	sessionId: string,
	content: string,
): Promise<{ outputFile: string; outputBytes: number } | null> {
	try {
		const dir = path.join(WORKSPACE_DIR, "browser-output");
		await mkdir(dir, { recursive: true });
		const outputFile = path.join(dir, `${sessionId}.txt`);
		await writeFile(outputFile, content, "utf-8");
		const outputBytes = Buffer.byteLength(content, "utf-8");
		pruneOutputDir(dir, LRU_KEEP).catch(() => {});
		return { outputFile, outputBytes };
	} catch (err) {
		logger.warn(`[browser] spill-to-file failed: ${err}`);
		return null;
	}
}

function buildBrowserDescription(config: OpenMantisConfig): string {
	const base =
		"Run an `agent-browser` subcommand. Pass the subcommand and its args as `args[]` " +
		'(e.g. `["open","https://example.com"]`, `["snapshot","-i"]`). Session and profile ' +
		"flags are managed automatically — do NOT pass `--session`, `--profile`, `--cdp`, or " +
		"`--auto-connect`. Default timeout 60s; for long waits/downloads pass `timeout` " +
		"explicitly. Returns stdout/stderr in `output`; outputs over the threshold spill to " +
		"`outputFile` (use `file_read` with offset/limit to inspect). Use `browser_help` " +
		"first if you don't know the subcommand to use.";
	const cdp = config.browser?.cdp;
	const cdpActive = cdp?.autoConnect === true || typeof cdp?.port === "number";
	if (!cdpActive) return base;
	const warning =
		"\n\nCDP MODE: This browser shares cookies and login state with the user's real " +
		"Chrome. NEVER perform destructive or irreversible actions without explicit user " +
		"confirmation. This includes (non-exhaustive): logging out, deleting data, sending " +
		"messages, posting content, submitting forms, making purchases, changing account " +
		"settings, revoking access. When in doubt, stop and ask the user — do not guess.";
	return base + warning;
}

export const BROWSER_TOOL_GUIDE = `## Browser Tools Usage Guide

- **browser_help**: Read this FIRST. Loads version-matched usage docs from the installed CLI. Default topic "core" covers the snapshot-and-ref loop, navigation, interaction, waiting, and common workflows.
- **browser**: Run an agent-browser subcommand. Pass args as a string array. Session/profile/CDP flags are auto-managed — passing them yourself is rejected. For long waits or downloads, pass an explicit timeout. Outputs over ~100K chars spill to outputFile; use file_read to inspect specific ranges.
- **browser_kill**: Last-resort termination. Prefer a longer timeout over killing.`;

export interface BrowserToolContext {
	routeId: string;
}

export function createBrowserTools(
	config: OpenMantisConfig,
	ctx: BrowserToolContext,
): Record<string, Tool> {
	const binPath = config.browser?.binPath ?? "agent-browser";
	const configDefaultMax = config.browser?.maxOutputLength;

	const browser = tool({
		description: buildBrowserDescription(config),
		inputSchema: z.object({
			args: z
				.array(z.string())
				.min(1)
				.describe('Subcommand + args, e.g. ["open","https://example.com"]'),
			timeout: z
				.number()
				.optional()
				.describe("Total timeout in milliseconds (default 60000, max 600000)"),
			maxOutputLength: z
				.number()
				.optional()
				.describe(
					"Override output threshold in characters. Outputs beyond this size spill to a file.",
				),
			description: z.string().optional().describe("Brief description for logging"),
		}),
		execute: async ({ args, timeout, maxOutputLength, description }) => {
			const managed = detectManagedFlag(args);
			if (managed) {
				return {
					error: `flag '${managed}' is managed by the tool and must not be passed in args`,
				};
			}

			const sessionId = `browser_${crypto.randomUUID().slice(0, 8)}`;
			const timeoutMs = Math.min(timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
			const maxOut = Math.min(
				maxOutputLength ?? configDefaultMax ?? DEFAULT_MAX_OUTPUT,
				MAX_OUTPUT_LIMIT,
			);
			const autoFlags = buildAutoFlags(config, ctx.routeId);
			const argv = [binPath, ...autoFlags, ...args];

			const desc = description ? ` (${description})` : "";
			logger.debug(`[tool:browser] ${sessionId}${desc}: ${argv.join(" ")}`);

			let proc: ReturnType<typeof Bun.spawn>;
			try {
				proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
			} catch (err) {
				return {
					sessionId,
					output: "",
					status: "exited" as const,
					exitCode: -1,
					error: `failed to spawn agent-browser (binPath=${binPath}): ${err instanceof Error ? err.message : String(err)}`,
				};
			}

			const session: BrowserSession = { proc, startedAt: Date.now() };
			sessions.set(sessionId, session);

			let timedOut = false;
			const timeoutTimer = setTimeout(() => {
				if (!session.proc.killed) {
					timedOut = true;
					logger.debug(`[tool:browser] ${sessionId} timeout at ${timeoutMs}ms, killing`);
					session.proc.kill("SIGKILL");
				}
			}, timeoutMs);

			const [stdoutText, stderrText, exitCode] = await Promise.all([
				new Response(proc.stdout as ReadableStream).text(),
				new Response(proc.stderr as ReadableStream).text(),
				proc.exited,
			]);
			clearTimeout(timeoutTimer);

			const raw = stripAnsi(`${stdoutText}${stderrText}`);
			const status: "exited" | "timeout" = timedOut ? "timeout" : "exited";

			let resultOutput = raw;
			let spillMeta: { outputFile: string; outputBytes: number } | null = null;
			if (raw.length > maxOut) {
				spillMeta = await spillToFile(sessionId, raw);
				resultOutput = truncateOutput(raw, maxOut);
			}

			sessions.delete(sessionId);

			logger.debug(
				`[tool:browser] ${sessionId} status=${status} exitCode=${exitCode} rawLen=${raw.length} spilled=${spillMeta !== null}`,
			);

			const result: {
				sessionId: string;
				output: string;
				status: "exited" | "timeout";
				exitCode: number;
				outputFile?: string;
				outputBytes?: number;
				outputTruncated?: true;
			} = {
				sessionId,
				output: resultOutput,
				status,
				exitCode,
			};
			if (spillMeta) {
				result.outputFile = spillMeta.outputFile;
				result.outputBytes = spillMeta.outputBytes;
				result.outputTruncated = true;
			}
			return result;
		},
	});

	const browser_kill = tool({
		description:
			"Terminate a running `browser` session. Use ONLY when a command is truly stuck (e.g. blocked by a system dialog the user can't dismiss) or the user explicitly asks to stop it. Returns any output captured before termination. Slow commands that are working normally — wait them out via a longer `timeout` on the next call instead of killing.",
		inputSchema: z.object({
			sessionId: z.string().describe("Session ID returned by browser"),
		}),
		execute: async ({ sessionId }) => {
			const session = sessions.get(sessionId);
			if (!session) {
				return {
					error: "Session not found or already exited",
					status: "exited" as const,
					exitCode: -1,
				};
			}
			if (!session.proc.killed) {
				session.proc.kill("SIGKILL");
				await session.proc.exited;
			}
			sessions.delete(sessionId);
			return {
				output: "",
				status: "exited" as const,
				exitCode: -1,
			};
		},
	});

	const browser_help = tool({
		description:
			'Load `agent-browser` usage documentation. Call this BEFORE issuing any non-trivial `browser` command — the docs are version-matched to the installed CLI and explain the snapshot/ref workflow, common patterns, and troubleshooting. Default `topic` is "core" (overview + common patterns). Pass "core --full" for the full command reference; pass "electron" / "slack" / "dogfood" / "vercel-sandbox" / "agentcore" for specialized workflows.',
		inputSchema: z.object({
			topic: z
				.string()
				.optional()
				.describe(
					'Skill name. Default "core". Accepts "core --full" or specialized skills like "electron", "slack", "dogfood", "vercel-sandbox", "agentcore".',
				),
		}),
		execute: async ({ topic }) => {
			const effective = topic && topic.trim().length > 0 ? topic.trim() : "core";
			const tokens = effective.split(/\s+/).filter((t) => t.length > 0);
			const argv = [binPath, "skills", "get", ...tokens];
			try {
				const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
				const timer = setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, HELP_TIMEOUT);
				const [stdoutText, stderrText, exitCode] = await Promise.all([
					new Response(proc.stdout as ReadableStream).text(),
					new Response(proc.stderr as ReadableStream).text(),
					proc.exited,
				]);
				clearTimeout(timer);
				const body = stripAnsi(stdoutText);
				if (exitCode !== 0 || body.trim().length === 0) {
					return {
						success: false,
						error: `agent-browser skills get ${effective} failed (exitCode=${exitCode}): ${stripAnsi(stderrText).trim() || "no output"}. Check that agent-browser is installed (npm i -g agent-browser).`,
					};
				}
				return { success: true, topic: effective, instructions: body };
			} catch (err) {
				return {
					success: false,
					error: `failed to run agent-browser (binPath=${binPath}): ${err instanceof Error ? err.message : String(err)}. Check that agent-browser is installed.`,
				};
			}
		},
	});

	return { browser, browser_kill, browser_help };
}
