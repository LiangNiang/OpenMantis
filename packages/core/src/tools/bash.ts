import os from "node:os";
import type { OpenMantisConfig } from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import { WORKSPACE_DIR } from "@openmantis/common/paths";
import { tool } from "ai";
import { z } from "zod";

const logger = createLogger("core/tools");

interface PtySession {
	id: string;
	command: string;
	proc: ReturnType<typeof Bun.spawn>;
	output: string[];
	status: "running" | "waiting_for_input" | "exited";
	exitCode?: number;
	startedAt: number;
	lastDataAt: number;
	timeoutTimer: ReturnType<typeof setTimeout>;
	silenceTimer: ReturnType<typeof setTimeout> | null;
	silenceTimeoutMs: number;
	waitResolve: (() => void) | null;
}

const sessions = new Map<string, PtySession>();

const MAX_TIMEOUT = 600_000;
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape matching
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b\[[?]?[0-9;]*[a-zA-Z]/g;

function stripAnsi(text: string): string {
	return text.replace(ANSI_REGEX, "");
}

function truncateOutput(output: string, maxLength: number): string {
	if (output.length <= maxLength) return output;
	const halfLimit = Math.floor(maxLength / 2);
	const head = output.slice(0, halfLimit);
	const tail = output.slice(-halfLimit);
	const removed = output.length - maxLength;
	return `${head}\n\n[... truncated ${removed} characters ...]\n\n${tail}`;
}

function getShellEnvironmentHint(): string {
	const platform = os.platform();
	const arch = os.arch();
	if (platform === "win32") {
		return `Environment: Windows ${os.release()} (${arch}), Shell: PowerShell. Use PowerShell-compatible syntax.`;
	}
	const shell = process.env.SHELL || "bash";
	return `Environment: ${platform === "darwin" ? "macOS" : "Linux"} ${os.release()} (${arch}), Shell: ${shell}.`;
}

function cleanupSession(session: PtySession): void {
	clearTimeout(session.timeoutTimer);
	if (session.silenceTimer) clearTimeout(session.silenceTimer);
	session.silenceTimer = null;
}

const KILL_GRACE_MS = 500;

async function killSession(session: PtySession): Promise<void> {
	// Cast to string: status can mutate via proc.exited.then while awaiting,
	// so TS's narrowing after the first check is incorrect.
	if ((session.status as string) === "exited") return;
	const pid = session.proc.pid;
	const isWindows = os.platform() === "win32";

	if (isWindows) {
		try {
			session.proc.kill("SIGKILL");
		} catch {
			// already dead
		}
		return;
	}

	// Unix: signal the whole process group (negative PID).
	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		// ESRCH — process already gone
		return;
	}

	await new Promise<void>((resolve) => setTimeout(resolve, KILL_GRACE_MS));

	if ((session.status as string) === "exited") return;
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		// ESRCH — exited during grace window
	}
}

function bindAbortSignal(session: PtySession, signal: AbortSignal): () => void {
	const handler = () => {
		logger.debug(`[tool:bash] session ${session.id} aborted by signal, killing`);
		void killSession(session).finally(() => {
			cleanupSession(session);
			sessions.delete(session.id);
			session.waitResolve?.();
		});
	};

	if (signal.aborted) {
		// Fire async to avoid running handler before caller awaits createWaitPromise.
		queueMicrotask(handler);
		return () => {};
	}

	signal.addEventListener("abort", handler, { once: true });
	return () => signal.removeEventListener("abort", handler);
}

function resetSilenceTimer(session: PtySession): void {
	if (session.silenceTimer) clearTimeout(session.silenceTimer);
	if (session.status === "exited") return;
	session.silenceTimer = setTimeout(() => {
		if (session.status === "running") {
			session.status = "waiting_for_input";
			logger.debug(
				`[tool:bash] session ${session.id} silence timeout (${session.silenceTimeoutMs}ms), status -> waiting_for_input`,
			);
			session.waitResolve?.();
		}
	}, session.silenceTimeoutMs);
}

function createWaitPromise(session: PtySession): Promise<void> {
	if (session.status !== "running") return Promise.resolve();
	return new Promise<void>((resolve) => {
		session.waitResolve = resolve;
	});
}

function getSessionOutput(session: PtySession, maxLength: number): string {
	const raw = session.output.join("");
	const cleaned = stripAnsi(raw);
	return truncateOutput(cleaned, maxLength);
}

function startSession(
	command: string,
	cwd: string,
	timeoutMs: number,
	silenceTimeoutMs: number,
): PtySession {
	const id = `pty_${crypto.randomUUID().slice(0, 8)}`;
	const decoder = new TextDecoder();

	const session: PtySession = {
		id,
		command,
		proc: null!,
		output: [],
		status: "running",
		exitCode: undefined,
		startedAt: Date.now(),
		lastDataAt: Date.now(),
		timeoutTimer: null!,
		silenceTimer: null,
		silenceTimeoutMs,
		waitResolve: null,
	};

	const proc = Bun.spawn(["bash", "-c", command], {
		cwd,
		terminal: {
			cols: 120,
			rows: 40,
			data(_terminal, data) {
				const chunk = decoder.decode(data);
				session.output.push(chunk);
				session.lastDataAt = Date.now();
				resetSilenceTimer(session);
			},
		},
		env: process.env,
	});

	session.proc = proc;

	// Total timeout — kill unconditionally
	session.timeoutTimer = setTimeout(() => {
		if (session.status !== "exited") {
			logger.debug(`[tool:bash] session ${id} total timeout (${timeoutMs}ms), killing`);
			session.proc.kill("SIGKILL");
		}
	}, timeoutMs);

	// Handle process exit
	proc.exited.then((code) => {
		session.status = "exited";
		session.exitCode = code;
		cleanupSession(session);
		logger.debug(`[tool:bash] session ${id} exited with code ${code}`);
		session.waitResolve?.();
	});

	// Start silence detection
	resetSilenceTimer(session);

	sessions.set(id, session);
	logger.debug(`[tool:bash] session ${id} started: "${command}"`);

	return session;
}

export const BASH_TOOL_GUIDE = `## Bash Tools Usage Guide

**Important:** Do NOT use bash for tasks that dedicated tools handle better:
- File operations → use file_read / file_write / file_edit (NOT cat/head/tail/echo/sed/awk)
- File search → use file_search (NOT find/ls)
- Content search → use content_search (NOT grep/rg)
Using dedicated tools returns structured results, significantly reduces token usage, and avoids shell escaping issues.

### bash — Execute shell commands
- Use for: system commands, package management, git operations, builds, running scripts, installing dependencies, process management, and any task that requires shell execution.
- Always provide the \`description\` parameter with a brief explanation of what the command does — this helps with readability and audit.
- Prefer precise, single-purpose commands. Avoid long shell pipelines when a dedicated tool can do the job.
- Quote file paths containing spaces with double quotes.
- Commands run in the project working directory. Use absolute paths to avoid ambiguity.
- Default timeout is 600 seconds (10 minutes). For known short commands, set a shorter timeout. For long-running operations (builds, large downloads), the default is usually sufficient.
- All generated files (documents, reports, images, audio, downloads, etc.) MUST end up in \`${WORKSPACE_DIR}/\`. Create the directory first if needed. Never leave output files in the project root, skill directories, or other locations.
- When running skill scripts: use ABSOLUTE paths (never \`cd\` into the skill directory). If the script supports an output directory flag, use it to write to \`${WORKSPACE_DIR}/\`. If not, run the script then move output files to \`${WORKSPACE_DIR}/\`.

### bash_write — Send input to a running session
- Use when bash returns status "waiting_for_input" and you need to provide interactive input (e.g., confirming a prompt, entering a value).
- For sensitive input (passwords, tokens, credentials): ask the user first in conversation, never guess.
- For routine confirmations (y/N prompts): send directly.
- A trailing newline is appended automatically — do not add your own.

### bash_wait — Continue waiting on a long-running session
- Use when bash returns status "waiting_for_input" but the command is actually still working (not waiting for input).
- Common scenarios: API calls, image/video generation, model inference, large downloads, builds, package installs.
- Call bash_wait instead of bash_kill — do NOT kill commands that are simply taking time.
- You can call bash_wait multiple times if the operation continues beyond a single wait period.

### bash_kill — Terminate a session
- Use ONLY as a last resort when a command is truly stuck, the user requests termination, or continuing serves no purpose.
- Do NOT kill commands that are simply slow — use bash_wait instead.
- Returns any output captured before termination.

### Handling "waiting_for_input" status
When bash returns \`waiting_for_input\`, follow this priority:
1. **Assume long-running first** — for API calls, image generation, model inference, downloads, builds, or installs → call bash_wait. Do NOT kill.
2. **Interactive prompts requiring user info** — sudo/ssh passwords, [y/N] confirmations, login credentials → ask the user in conversation first, then use bash_write. Never guess passwords.
3. **Known non-sensitive input** — routine script confirmations → use bash_write directly.
4. **Kill only as last resort** — only use bash_kill when the command is truly stuck or the user requests it.
5. If the result includes a "hint" field, follow its guidance.`;

export function createBashTools(config?: OpenMantisConfig) {
	const cwd = process.cwd();
	const defaultTimeoutMs = config?.bash?.timeout ?? MAX_TIMEOUT;
	const maxOutputLength = config?.bash?.maxOutputLength ?? 30_000;
	const silenceTimeoutMs = config?.bash?.silenceTimeout ?? 10_000;

	const bash = tool({
		description: `Execute a shell command and return its output and status. ${getShellEnvironmentHint()}

All generated files (documents, reports, images, audio, downloads, etc.) MUST end up in ${WORKSPACE_DIR}/. Create the directory first if it doesn't exist. Never leave output files in the project root, skill directories, or other locations.
When running skill scripts: use ABSOLUTE paths (never cd into the skill directory). If the script supports an output directory flag (--outdir, -o, etc.), use it to write directly to ${WORKSPACE_DIR}/. If not, run the script then move the output files to ${WORKSPACE_DIR}/.

When status is "waiting_for_input", the command produced no output within the silence window. It may still be running normally (network requests, builds, model inference, image generation) or waiting for interactive input. Handle by priority:
1. **Assume long-running first**: For API calls, image/video generation, model inference, downloads, builds, or installs — call bash_wait to continue waiting. Do NOT kill.
2. **Interactive prompts requiring user info** (sudo/ssh passwords, [y/N] confirmations, login credentials): Ask the user in conversation first, then use bash_write. Never guess passwords.
3. **Known non-sensitive input** (routine script confirmations): Use bash_write directly.
4. **Kill only as last resort**: Only use bash_kill when the command is truly stuck, the user requests it, or continuing serves no purpose.
5. If the result includes a "hint" field, follow its guidance.`,
		inputSchema: z.object({
			command: z.string().describe("The command to execute"),
			timeout: z.number().optional().describe("Total timeout in milliseconds, default 600000"),
			description: z.string().optional().describe("Brief description of what this command does"),
		}),
		execute: async ({ command, timeout, description }, options?: { abortSignal?: AbortSignal }) => {
			if (options?.abortSignal?.aborted) {
				throw options.abortSignal.reason ?? new Error("bash aborted before execution");
			}

			const timeoutMs = Math.min(timeout ?? defaultTimeoutMs, MAX_TIMEOUT);
			const desc = description ? ` (${description})` : "";
			logger.debug(`[tool:bash] executing${desc}: ${command}`);

			// Use a longer silence window for browser commands to avoid false waiting_for_input.
			const effectiveSilenceMs = command.includes("agent-browser")
				? Math.max(silenceTimeoutMs, 15_000)
				: silenceTimeoutMs;

			const session = startSession(command, cwd, timeoutMs, effectiveSilenceMs);
			const detach = options?.abortSignal
				? bindAbortSignal(session, options.abortSignal)
				: () => {};

			try {
				await createWaitPromise(session);

				if (options?.abortSignal?.aborted) {
					throw options.abortSignal.reason ?? new Error("bash aborted");
				}

				const output = getSessionOutput(session, maxOutputLength);

				logger.debug(
					`[tool:bash] bash returning: sessionId=${session.id}, status=${session.status}, exitCode=${session.exitCode}, outputLen=${output.length}`,
				);

				if (session.status === "exited") {
					sessions.delete(session.id);
				}

				const result: {
					sessionId: string;
					output: string;
					status: "exited" | "waiting_for_input";
					exitCode?: number;
					hint?: string;
				} = {
					sessionId: session.id,
					output,
					status: session.status as "exited" | "waiting_for_input",
					...(session.exitCode !== undefined && { exitCode: session.exitCode }),
				};

				if (session.status === "waiting_for_input" && output.length === 0) {
					result.hint = command.includes("agent-browser")
						? "No output produced. The browser may be blocked by a system dialog (e.g. Restore Pages prompt, keychain password, profile selection). Ask the user to dismiss the dialog manually (via remote desktop if needed), or call bash_kill and retry. Do not retry the same command."
						: "No output produced. If this is a known long-running operation (API call, image generation, model inference, download, build), call bash_wait to continue waiting — do NOT kill. Only use bash_write or bash_kill if you confirm an interactive prompt or a truly stuck process.";
				}

				return result;
			} finally {
				detach();
			}
		},
	});

	const bash_write = tool({
		description:
			"Write input to a running bash session. Sends the input (with trailing newline), waits for the command to continue, and returns any new output produced.",
		inputSchema: z.object({
			sessionId: z.string().describe("Session ID returned by bash"),
			input: z.string().describe("Content to write (a newline is appended automatically)"),
		}),
		execute: async ({ sessionId, input }) => {
			const session = sessions.get(sessionId);
			if (!session) {
				return { error: "Session not found or already exited", status: "exited" as const };
			}
			if (session.status === "exited") {
				const output = getSessionOutput(session, maxOutputLength);
				sessions.delete(sessionId);
				return { output, status: "exited" as const, exitCode: session.exitCode };
			}

			// Record output length before write to return only new output
			const prevLength = session.output.length;

			// Reset to running and write input
			session.status = "running";
			session.proc.terminal!.write(`${input}\n`);
			logger.debug(`[tool:bash] session ${sessionId} write: "${input}"`);

			// Wait for process exit or silence timeout
			await createWaitPromise(session);

			const newOutput = stripAnsi(session.output.slice(prevLength).join(""));
			const truncated = truncateOutput(newOutput, maxOutputLength);

			logger.debug(
				`[tool:bash] bash_write returning: sessionId=${sessionId}, status=${session.status}, newOutputLen=${truncated.length}`,
			);

			return {
				output: truncated,
				status: session.status as "exited" | "waiting_for_input",
				...(session.exitCode !== undefined && { exitCode: session.exitCode }),
			};
		},
	});

	const bash_wait = tool({
		description:
			"Continue waiting on a bash session that reported waiting_for_input. Use this for known long-running operations (API calls, image generation, model inference, downloads, builds). Returns new output and current status. Call again if the process is still running.",
		inputSchema: z.object({
			sessionId: z.string().describe("Session ID returned by bash"),
			timeout: z
				.number()
				.optional()
				.describe("Max wait time in milliseconds (default 60000, max 600000)"),
		}),
		execute: async ({ sessionId, timeout }) => {
			const session = sessions.get(sessionId);
			if (!session) {
				return { error: "Session not found or already exited", status: "exited" as const };
			}
			if (session.status === "exited") {
				const output = getSessionOutput(session, maxOutputLength);
				sessions.delete(sessionId);
				return {
					output,
					status: "exited" as const,
					...(session.exitCode !== undefined && { exitCode: session.exitCode }),
				};
			}

			const prevLength = session.output.length;
			const waitMs = Math.min(Math.max(timeout ?? 60_000, 1_000), MAX_TIMEOUT);

			// Re-arm: pretend we're running again, with a longer silence window for this wait.
			const previousSilence = session.silenceTimeoutMs;
			session.silenceTimeoutMs = waitMs;
			session.status = "running";
			resetSilenceTimer(session);

			await createWaitPromise(session);

			// Restore default silence window for any future writes.
			session.silenceTimeoutMs = previousSilence;

			const newOutput = stripAnsi(session.output.slice(prevLength).join(""));
			const truncated = truncateOutput(newOutput, maxOutputLength);

			logger.debug(
				`[tool:bash] bash_wait returning: sessionId=${sessionId}, status=${session.status}, newOutputLen=${truncated.length}`,
			);

			const finalStatus = session.status as PtySession["status"];
			if (finalStatus === "exited") {
				sessions.delete(sessionId);
			}

			return {
				output: truncated,
				status: finalStatus as "exited" | "waiting_for_input",
				...(session.exitCode !== undefined && { exitCode: session.exitCode }),
			};
		},
	});

	const bash_kill = tool({
		description:
			"Terminate a running bash session. Returns any captured output before termination.",
		inputSchema: z.object({
			sessionId: z.string().describe("Session ID to terminate"),
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

			if (session.status !== "exited") {
				session.proc.kill("SIGKILL");
				await session.proc.exited;
			}

			const output = getSessionOutput(session, maxOutputLength);
			const exitCode = session.exitCode ?? -1;
			sessions.delete(sessionId);

			logger.debug(`[tool:bash] session ${sessionId} killed, exitCode=${exitCode}`);

			return { output, status: "exited" as const, exitCode };
		},
	});

	return { bash, bash_write, bash_wait, bash_kill };
}
