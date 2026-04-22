# agent-browser 工具化重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the agent-browser SKILL-stub + bash special-cases + system-prompt-section composition with a first-class `browser` tool group (`browser` / `browser_kill` / `browser_help`) that enforces session/profile isolation at runtime.

**Architecture:** New `packages/core/src/tools/browser.ts` owns all three tools, auto-injects `--session` / `--profile` / `--cdp` / `--auto-connect` flags based on `config.browser.cdp`, and rejects attempts to pass those flags in `args`. Large outputs spill to `<WORKSPACE_DIR>/browser-output/<sessionId>.txt` with LRU=50 pruning. `config.browser.*` shape is preserved (only one new optional `maxOutputLength` field). Existing SKILL stub, bash special-cases, and `browser-prompt.ts` are deleted.

**Tech Stack:** Bun (spawn), TypeScript, Vercel AI SDK `tool()` + Zod schemas, Biome (lint/format), consola logger.

**Project testing convention (from CLAUDE.md + memory):** OpenMantis has no automated test suite. This plan relies on `bun run typecheck` + `bun run check` as CI gates, plus two manual smoke-test tasks at the end. No new test files are written.

**Spec:** `docs/superpowers/specs/2026-04-22-agent-browser-tool-design.md`

---

## Task 1: Add `maxOutputLength` to `browserConfigSchema`

**Files:**
- Modify: `packages/common/src/config/schema.ts:76-80`

- [ ] **Step 1: Edit the schema**

Open `packages/common/src/config/schema.ts`. Change the `browserConfigSchema` block from:

```ts
const browserConfigSchema = z.object({
	enabled: z.boolean().default(false),
	binPath: z.string().default("agent-browser"),
	cdp: browserCdpConfigSchema.optional(),
});
```

to:

```ts
const browserConfigSchema = z.object({
	enabled: z.boolean().default(false),
	binPath: z.string().default("agent-browser"),
	cdp: browserCdpConfigSchema.optional(),
	maxOutputLength: z.number().int().positive().optional(),
});
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes cleanly (no errors introduced).

- [ ] **Step 3: Commit**

```bash
git add packages/common/src/config/schema.ts
git commit -m "feat(common): add optional browser.maxOutputLength config"
```

---

## Task 2: Create `packages/core/src/tools/browser.ts`

**Files:**
- Create: `packages/core/src/tools/browser.ts`

This file implements all three tools (`browser`, `browser_kill`, `browser_help`) plus `BROWSER_TOOL_GUIDE` and `createBrowserTools()`.

- [ ] **Step 1: Write the full file**

Create `packages/core/src/tools/browser.ts` with exactly this content:

```ts
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
					logger.debug(
						`[tool:browser] ${sessionId} timeout at ${timeoutMs}ms, killing`,
					);
					session.proc.kill("SIGKILL");
				}
			}, timeoutMs);

			const [stdoutText, stderrText, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
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
					new Response(proc.stdout).text(),
					new Response(proc.stderr).text(),
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
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: passes cleanly. The file is self-contained and not yet referenced from anywhere else, so this confirms its internal types are correct.

- [ ] **Step 3: Biome check**

Run: `bun run check`
Expected: passes, auto-fixes any trivial formatting. If lint errors remain, fix them before committing. The single `biome-ignore` comment on `ANSI_REGEX` must remain.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/tools/browser.ts
git commit -m "feat(core/tools): add browser, browser_kill, browser_help tools"
```

---

## Task 3: Wire browser group into `resolveTools`

**Files:**
- Modify: `packages/core/src/tools/index.ts`

- [ ] **Step 1: Add import for the new module**

In `packages/core/src/tools/index.ts`, under the existing import block (lines 10-21), add:

```ts
import { BROWSER_TOOL_GUIDE, createBrowserTools } from "./browser";
```

Insert it alphabetically — right after the `import { BASH_TOOL_GUIDE, createBashTools } from "./bash";` line.

- [ ] **Step 2: Register `"browser"` in `ALL_TOOL_GROUPS`**

Current (lines 52-64):

```ts
const ALL_TOOL_GROUPS = [
	"bash",
	"file",
	"search",
	"skills",
	"tavily",
	"exa",
	"schedule",
	"rss",
	"whisper",
	"tts",
	"memory",
] as const;
```

Change to:

```ts
const ALL_TOOL_GROUPS = [
	"bash",
	"browser",
	"file",
	"search",
	"skills",
	"tavily",
	"exa",
	"schedule",
	"rss",
	"whisper",
	"tts",
	"memory",
] as const;
```

- [ ] **Step 3: Add the `case "browser"` branch**

In the `switch (group)` inside `resolveTools` (starts at line 78), add a new case immediately after the existing `case "bash"` block (which ends around line 84). Insert:

```ts
			case "browser": {
				if (!config || config.browser?.enabled !== true) break;
				if (!channelCtx?.routeId) {
					logger.debug("[resolveTools] skipping browser tools: no routeId");
					break;
				}
				const browserTools = createBrowserTools(config, { routeId: channelCtx.routeId });
				Object.assign(tools, browserTools);
				guides.push(BROWSER_TOOL_GUIDE);
				break;
			}
```

The `!config` guard is needed so TypeScript narrows `config` to the non-optional `OpenMantisConfig` type for the `createBrowserTools` call (the parameter type is non-optional).

- [ ] **Step 4: Export `createBrowserTools`**

Append to the bottom export list (currently ending at line 211 with `export { createWhisperTools } from "./whisper";`). Add, in alphabetical position right after the existing `export { createBashTools }` line:

```ts
export { createBrowserTools } from "./browser";
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: passes. This proves `createBrowserTools` signature matches what `resolveTools` calls.

- [ ] **Step 6: Biome check**

Run: `bun run check`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/tools/index.ts
git commit -m "feat(core/tools): register browser tool group in resolveTools"
```

---

## Task 4: Remove browser filter from `skills.ts`

**Files:**
- Modify: `packages/core/src/tools/skills.ts`

- [ ] **Step 1: Delete `BROWSER_SKILL_NAME` constant**

Currently at line 13:
```ts
const BROWSER_SKILL_NAME = "agent-browser";
```

Delete that entire line. The surrounding file should keep the `const logger = createLogger("core/tools");` line above it and the `function resolveSkillsRoot()` below it.

- [ ] **Step 2: Delete the filter block**

Currently inside `createSkillTools` (lines 278-281):

```ts
				let skills = await discoverSkills(builtinDir, "skills/builtin");
				if (config?.browser?.enabled !== true) {
					skills = skills.filter((s) => s.name !== BROWSER_SKILL_NAME);
				}
```

Change to:

```ts
				const skills = await discoverSkills(builtinDir, "skills/builtin");
```

Note: `let` → `const` since we no longer reassign.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: passes — `BROWSER_SKILL_NAME` should have no other references (we just confirmed grep finds only the two locations we edited).

- [ ] **Step 4: Biome check**

Run: `bun run check`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tools/skills.ts
git commit -m "refactor(core/tools): stop filtering agent-browser skill in skills registry"
```

---

## Task 5: Remove `agent-browser` special-cases from `bash.ts`

**Files:**
- Modify: `packages/core/src/tools/bash.ts`

- [ ] **Step 1: Simplify silence-timeout branch**

Currently lines 225-230 inside the `bash` tool's `execute`:

```ts
				// Use a longer silence window for browser commands to avoid false waiting_for_input.
				const effectiveSilenceMs = command.includes("agent-browser")
					? Math.max(silenceTimeoutMs, 15_000)
					: silenceTimeoutMs;

				const session = startSession(command, cwd, timeoutMs, effectiveSilenceMs);
```

Change to:

```ts
				const session = startSession(command, cwd, timeoutMs, silenceTimeoutMs);
```

(Drops the 3 `effectiveSilenceMs` lines plus the comment.)

- [ ] **Step 2: Simplify hint branch**

Currently lines 258-262:

```ts
				if (session.status === "waiting_for_input" && output.length === 0) {
					result.hint = command.includes("agent-browser")
						? "No output produced. The browser may be blocked by a system dialog (e.g. Restore Pages prompt, keychain password, profile selection). Ask the user to dismiss the dialog manually (via remote desktop if needed), or call bash_kill and retry. Do not retry the same command."
						: "No output produced. If this is a known long-running operation (API call, image generation, model inference, download, build), call bash_wait to continue waiting — do NOT kill. Only use bash_write or bash_kill if you confirm an interactive prompt or a truly stuck process.";
				}
```

Change to:

```ts
				if (session.status === "waiting_for_input" && output.length === 0) {
					result.hint =
						"No output produced. If this is a known long-running operation (API call, image generation, model inference, download, build), call bash_wait to continue waiting — do NOT kill. Only use bash_write or bash_kill if you confirm an interactive prompt or a truly stuck process.";
				}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: passes.

- [ ] **Step 4: Biome check**

Run: `bun run check`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tools/bash.ts
git commit -m "refactor(core/tools): remove agent-browser special-cases from bash"
```

---

## Task 6: Remove `buildBrowserPromptSection` from `factory.ts` + delete `browser-prompt.ts`

**Files:**
- Modify: `packages/core/src/agent/factory.ts`
- Delete: `packages/core/src/agent/browser-prompt.ts`

- [ ] **Step 1: Remove the import**

In `packages/core/src/agent/factory.ts`, delete line 14:

```ts
import { buildBrowserPromptSection } from "./browser-prompt";
```

- [ ] **Step 2: Remove the injection block**

Currently lines 88-91:

```ts
		const browserSection = buildBrowserPromptSection(this.config, options?.routeId);
		if (browserSection) {
			instructions += `\n\n${browserSection}`;
		}
```

Delete all four lines. The preceding line (87, empty or ending `}`) should naturally continue to the subsequent `// Inject core memory into system prompt` comment (line 93).

- [ ] **Step 3: Delete the `browser-prompt.ts` file**

```bash
rm packages/core/src/agent/browser-prompt.ts
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: passes. `buildBrowserPromptSection` had no other callers (confirmed in the exploration phase).

- [ ] **Step 5: Biome check**

Run: `bun run check`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/factory.ts packages/core/src/agent/browser-prompt.ts
git commit -m "refactor(core/agent): remove browser-prompt injection; superseded by browser tool"
```

Note: `git add` on a deleted file records the deletion. Verify with `git status` before commit — it should show `deleted: packages/core/src/agent/browser-prompt.ts` and `modified: packages/core/src/agent/factory.ts`.

---

## Task 7: Delete `skills/builtin/agent-browser/` directory

**Files:**
- Delete: `skills/builtin/agent-browser/` (entire directory, including `SKILL.md`)

- [ ] **Step 1: Remove the directory**

```bash
rm -rf skills/builtin/agent-browser
```

- [ ] **Step 2: Verify nothing else references it**

```bash
git ls-files skills/builtin/agent-browser/
```

Expected: empty output (all files staged for deletion are tracked by git but no longer on disk).

Also grep the codebase for any stray references. Use the Grep tool with pattern `skills/builtin/agent-browser` across the whole repo — expected: no matches outside committed documentation in `docs/`.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: passes — the skill was discovered dynamically from the filesystem by `skills.ts`, so no static imports reference it.

- [ ] **Step 4: Commit**

```bash
git add skills/builtin/agent-browser
git commit -m "chore(skills): remove agent-browser skill stub (superseded by browser tool)"
```

---

## Task 8: Full-repo validation

**Files:** none (validation only)

- [ ] **Step 1: Full typecheck**

Run: `bun run typecheck`
Expected: passes cleanly across the whole monorepo.

- [ ] **Step 2: Full biome check**

Run: `bun run check`
Expected: passes cleanly. If any file was touched by `--unsafe` fixes, re-review the diff with `git diff` and commit if the changes are acceptable, under a `style: biome auto-format` commit message. Otherwise move on.

- [ ] **Step 3: Final grep audit**

Run a Grep tool call with pattern `buildBrowserPromptSection|BROWSER_SKILL_NAME|skills/builtin/agent-browser` across the repo.
Expected: matches only in `docs/superpowers/specs/` and `docs/superpowers/plans/` (the design doc and this plan), nowhere else.

---

## Task 9: Manual smoke test — isolation mode

**Pre-reqs:**
- `agent-browser` CLI installed (`which agent-browser` succeeds)
- A config with `browser.enabled: true` and NO `browser.cdp` (or `cdp: null`)
- A Feishu/WeCom/QQ channel wired up so you can actually send a message and hit a real route

**Steps:**

- [ ] **Step 1: Start the service**

```bash
bun run dev
```

Wait for the startup log confirming channels are bound. Confirm there is no warning about `browser-prompt` or `agent-browser skill` (those code paths are gone).

- [ ] **Step 2: Send a test message to exercise `browser_help`**

Send a channel message like: `用 browser_help 给我 core 用法说明，不用真的打开浏览器`

Expected behavior:
- Model calls `browser_help` with `topic: "core"` (or no arg).
- Tool result contains a long markdown document starting with `# agent-browser core`.
- No errors about missing binary.

- [ ] **Step 3: Send a test message to exercise `browser` (happy path)**

Send: `打开 https://example.com 然后给我 snapshot -i`

Expected behavior:
- Model first calls `browser` with `args: ["open", "https://example.com"]`.
- Debug logs (`LOG_LEVEL=debug`) show the spawned command includes `--session route-<routeId> --profile <absolute browser-profiles path>`.
- Follow-up call `browser` with `args: ["snapshot", "-i"]` returns the accessibility tree for example.com (contains `@e1` refs).
- No `outputFile` field (output is small).

Check the filesystem:
```bash
ls ~/.openmantis/browser-profiles/
```
Expected: a directory matching the current `routeId`.

- [ ] **Step 4: Exercise args safety gate**

Send: `调用 browser，args 传 ["--session", "hacker", "open", "https://example.com"]`

Expected: tool result contains `error: "flag '--session' is managed by the tool and must not be passed in args"`. The model should either report the failure or retry without the illegal flag.

- [ ] **Step 5: Exercise spill-to-file**

Send: `用 browser 跑 ["eval", "Array(200000).fill('x').join('')"]`（or any command producing >100K chars of output; can also use `get html body` on a large page)

Expected:
- Tool result has `outputTruncated: true` and an `outputFile` path.
- That file exists on disk: `ls ~/.openmantis/workspace/browser-output/` should list a `browser_<8hex>.txt`.
- Model may follow up with `file_read` using `offset`/`limit` to inspect.

- [ ] **Step 6: Verify LRU (optional if slow)**

Repeat Step 5 about 51 times (or write a throwaway script) and confirm `~/.openmantis/workspace/browser-output/` never exceeds 50 files.

- [ ] **Step 7: Stop the service**

```bash
# In another terminal
openmantis stop
```

or Ctrl-C the dev process.

---

## Task 10: Manual smoke test — CDP mode

**Pre-reqs:**
- User's Chrome running with remote debugging port, e.g. launched with `--remote-debugging-port=9222`, OR a CDP auto-connect target reachable.
- Config updated: `browser.cdp.port: 9222` (or `browser.cdp.autoConnect: true`).

**Steps:**

- [ ] **Step 1: Start the service and verify tool description**

```bash
LOG_LEVEL=debug DEBUG_PROMPT=true bun run dev
```

Look at the dumped system prompt (triggered by `DEBUG_PROMPT=true`) and verify the `## Browser automation` section from `browser-prompt.ts` is **absent**. Also check the listed tools — the `browser` tool description (visible in Vercel AI SDK's request payload in debug logs, or by grepping `logger.debug("[agent] tool:"`) should contain the `CDP MODE:` warning paragraph.

- [ ] **Step 2: Exercise `browser` in CDP mode**

Send a channel message: `用 browser snapshot -i 当前 Chrome 标签页`

Expected:
- Spawned command (from debug logs) contains `--cdp 9222 --session route-<routeId>` (or `--auto-connect --session route-<routeId>`), and does **NOT** contain `--profile`.
- Snapshot returns successfully — confirming the attached Chrome was introspected.

- [ ] **Step 3: Exercise CDP managed-flag protection**

Send: `用 browser args: ["--profile", "/tmp/hack", "snapshot"]`

Expected: `error: "flag '--profile' is managed by the tool and must not be passed in args"` (this check is mode-agnostic).

- [ ] **Step 4: Stop the service**

```bash
openmantis stop
```

---

## Summary of changes on disk

After completing all tasks, `git log --oneline` since the pre-Task-1 commit should show approximately:

```
feat(common): add optional browser.maxOutputLength config
feat(core/tools): add browser, browser_kill, browser_help tools
feat(core/tools): register browser tool group in resolveTools
refactor(core/tools): stop filtering agent-browser skill in skills registry
refactor(core/tools): remove agent-browser special-cases from bash
refactor(core/agent): remove browser-prompt injection; superseded by browser tool
chore(skills): remove agent-browser skill stub (superseded by browser tool)
```

Total net line count: roughly +350 (new `browser.ts`) / −160 (deleted `browser-prompt.ts` + `SKILL.md` + `skills.ts` filter + `bash.ts` special cases + `factory.ts` injection) ≈ +190 net. Single feature change, reviewable as a sequence of focused commits.
