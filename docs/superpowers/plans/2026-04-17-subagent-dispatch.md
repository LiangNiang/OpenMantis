# Subagent Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic `subagent` tool to OpenMantis that dispatches a fresh headless agent for context isolation and parallel task execution.

**Architecture:** A new `subagent.ts` tool module holds a module-level semaphore (8 slots) plus an `AsyncLocalStorage` depth counter (max 2). It instantiates fresh agents via a new `AgentFactory.createHeadless()` method that builds a `ToolLoopAgent` without channel context, memory, or user-visible tools. Parent abort signals propagate to all descendants via linked `AbortSignal`.

**Tech Stack:** Bun runtime, Vercel AI SDK v6 (`ToolLoopAgent`, `tool()`), Node `AsyncLocalStorage` from `node:async_hooks`, existing OpenMantis `AgentFactory` / `resolveTools`.

**Spec:** `docs/superpowers/specs/2026-04-17-subagent-dispatch-design.md`

---

## File Structure

- **New:** `packages/core/src/tools/subagent.ts` (~150 lines)
  - Constants, `Semaphore` class, `depthStorage` (AsyncLocalStorage), `createSubagentTools(config)`, `SUBAGENT_TOOL_GUIDE`
- **Modify:** `packages/core/src/agent/factory.ts`
  - Add `CreateHeadlessOptions` interface and `createHeadless()` method on `AgentFactory`
- **Modify:** `packages/core/src/tools/index.ts`
  - Export `ALL_TOOL_GROUPS`, add `"subagent"` group, add switch case and export

**Verification:** Project has no test suite by convention. After implementation, run `bun run typecheck` + `bun run check`, then manually exercise the 7 smoke scenarios in Task 4.

---

## Task 1: Add `createHeadless()` to `AgentFactory`

**Files:**
- Modify: `packages/core/src/tools/index.ts` (add `export` keyword to `ALL_TOOL_GROUPS`)
- Modify: `packages/core/src/agent/factory.ts` (add interface + method)

---

- [ ] **Step 1.1: Export `ALL_TOOL_GROUPS` from `tools/index.ts`**

Change line 52 in `packages/core/src/tools/index.ts`:

```ts
// before
const ALL_TOOL_GROUPS = [
// after
export const ALL_TOOL_GROUPS = [
```

(Just add the `export` keyword — the array contents stay identical.)

---

- [ ] **Step 1.2: Add `CreateHeadlessOptions` interface + `createHeadless()` method**

In `packages/core/src/agent/factory.ts`, add the interface near the top (right after `CreateAgentOptions`):

```ts
export interface CreateHeadlessOptions {
	/** Full system prompt for the headless agent. Required — caller supplies default. */
	systemPrompt: string;
	/** Provider name from config.providers[]. Falls back to config.defaultProvider. */
	provider?: string;
	/** Tool group names to include. All other groups are excluded. */
	allowedToolGroups: string[];
}
```

Update the import at the top to pull `ALL_TOOL_GROUPS`:

```ts
// before
import { type ChannelToolProviders, resolveTools } from "../tools";
// after
import { ALL_TOOL_GROUPS, type ChannelToolProviders, resolveTools } from "../tools";
```

Then add the `createHeadless` method inside the `AgentFactory` class (right after the existing `create()` method):

```ts
	async createHeadless(options: CreateHeadlessOptions): Promise<CreateAgentResult> {
		const providerConfig = resolveProvider(this.config, options.provider);
		const modelConfig: ModelConfig = providerConfig.models[0]!;
		const model = await createLanguageModel(providerConfig, modelConfig);
		const thinkingOpts = resolveThinkingOptions(providerConfig, modelConfig);

		let wrappedModel = model;
		if (thinkingOpts.middleware) {
			wrappedModel = wrapLanguageModel({
				model: wrappedModel,
				middleware: thinkingOpts.middleware,
			});
		}

		// Exclude every group NOT in allowedToolGroups, PLUS anything the user
		// already excluded globally via config.excludeTools (security/safety parity
		// with the channel-mode agent).
		const excludeGroups = Array.from(
			new Set([
				...ALL_TOOL_GROUPS.filter((g) => !options.allowedToolGroups.includes(g)),
				...(this.config.excludeTools ?? []),
			]),
		);

		const { tools } = await resolveTools(excludeGroups, this.config);

		const maxSteps = this.config.maxToolRoundtrips;

		if (process.env.DEBUG_PROMPT === "true") {
			logger.debug("[agent:headless] System prompt:", options.systemPrompt);
		}

		const agent = new ToolLoopAgent({
			model: wrappedModel,
			instructions: options.systemPrompt,
			tools,
			toolChoice: "auto",
			stopWhen: stepCountIs(maxSteps),
			providerOptions: {
				...(thinkingOpts.providerOptions ?? {}),
				...(modelConfig.providerOptions ?? {}),
			} as any,
			temperature: modelConfig.temperature,
			topP: modelConfig.topP,
			onStepFinish: (event) => {
				for (const tc of event.toolCalls) {
					const toolResult = event.toolResults.find((tr) => tr.toolCallId === tc.toolCallId);
					const input =
						typeof tc.input === "object" ? JSON.stringify(tc.input).slice(0, 200) : tc.input;
					const output = toolResult
						? JSON.stringify(toolResult.output).slice(0, 200)
						: "no result";
					logger.debug(`[agent:headless] tool:${tc.toolName} ${input} → ${output}`);
				}
			},
		});
		return { agent };
	}
```

**What's different from `create()`:**
- No `channelCtx` → `resolveTools` runs without channel context (no memory, no channel tools, no channel message tools)
- No `buildStructuredPrompt` / `browserSection` / core memory injection — `instructions` is just `options.systemPrompt`
- `excludeGroups` inverts the allowlist + merges user's global `excludeTools`

---

- [ ] **Step 1.3: Typecheck**

Run: `bun run typecheck`

Expected: Exits 0. Any errors must be from this task; resolve before continuing.

---

- [ ] **Step 1.4: Lint/format**

Run: `bun run check`

Expected: Exits 0 (Biome may auto-apply formatting).

---

- [ ] **Step 1.5: Commit**

```bash
git add packages/core/src/agent/factory.ts packages/core/src/tools/index.ts
git commit -m "feat(core/agent): add AgentFactory.createHeadless for subagent dispatch"
```

---

## Task 2: Create `subagent.ts` tool module

**Files:**
- Create: `packages/core/src/tools/subagent.ts`

---

- [ ] **Step 2.1: Create the complete `subagent.ts` file**

Create `packages/core/src/tools/subagent.ts` with exactly this content:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import type { OpenMantisConfig } from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import { type Tool, tool } from "ai";
import { z } from "zod";
import { AgentFactory } from "../agent/factory";

const logger = createLogger("core/tools");

const MAX_DEPTH = 2;
const MAX_CONCURRENCY = 8;
const TIMEOUT_MS = 300_000;

/**
 * Tool groups the child agent is allowed to use by default.
 * Deliberately excludes:
 *   - memory_*       (mutates user profile, leaks ephemeral reasoning)
 *   - message_*      (externally visible; parallel interleaves in user chat)
 *   - schedule_*     (persistent side effects)
 *   - tts / whisper  (external side effects)
 *   - channel-specific send tools (same as message_*)
 */
const DEFAULT_ALLOWED_TOOL_GROUPS = [
	"bash",
	"file",
	"search",
	"tavily",
	"exa",
	"rss",
	"skills",
	"subagent", // recursive dispatch allowed up to MAX_DEPTH
];

const DEFAULT_SUBAGENT_PROMPT = `You are a subagent dispatched by another agent.
Your response will be returned as a tool result.
Be direct and concise. No chitchat, no clarifying questions, no meta-commentary.
If the task is unclear, make the most reasonable interpretation and proceed.
Return only the final answer.`;

// ---------------------------------------------------------------------------
// Semaphore: simple FIFO queue, 8 permits.
// ---------------------------------------------------------------------------
class Semaphore {
	private permits: number;
	private queue: Array<() => void> = [];

	constructor(permits: number) {
		this.permits = permits;
	}

	async acquire(): Promise<void> {
		if (this.permits > 0) {
			this.permits--;
			return;
		}
		return new Promise<void>((resolve) => {
			this.queue.push(resolve);
		});
	}

	release(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.permits++;
		}
	}
}

const semaphore = new Semaphore(MAX_CONCURRENCY);

// ---------------------------------------------------------------------------
// Depth tracking via AsyncLocalStorage.
// A subagent's execute() wraps the child agent's run with depthStorage.run(),
// so any subagent tool invoked transitively inherits depth+1.
// ---------------------------------------------------------------------------
const depthStorage = new AsyncLocalStorage<{ depth: number }>();

// ---------------------------------------------------------------------------
// Public guide string appended to the parent agent's tool guide section.
// ---------------------------------------------------------------------------
export const SUBAGENT_TOOL_GUIDE =
	"- **subagent**: Dispatch a fresh, context-isolated child agent to execute an independent task. " +
	"Use for (a) long/complex subtasks you don't want polluting your own context, " +
	"(b) parallel fan-out — invoking multiple subagent calls in the same response runs them concurrently. " +
	"Input: `prompt` (required task description), optional `systemPrompt` (override default), optional `provider`. " +
	"Child has a reduced toolset (no memory/message/schedule/TTS). " +
	"Returns `{ success, text }` or `{ success: false, error }`. Depth cap: 2; concurrency cap: 8; timeout: 5 min.";

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------
export function createSubagentTools(config: OpenMantisConfig): Record<string, Tool> {
	const inputSchema = z.object({
		prompt: z.string().min(1).describe("The task for the subagent to execute. Single-turn."),
		systemPrompt: z
			.string()
			.optional()
			.describe("Override the default subagent system prompt. Caller fully owns the string."),
		provider: z
			.string()
			.optional()
			.describe("Provider name from config.providers[]. Defaults to config.defaultProvider."),
	});

	const subagentTool = tool({
		description:
			"Dispatch a fresh, isolated child agent. Context is NOT inherited from the parent. " +
			"Multiple calls in one response run in parallel. Max depth 2, max 8 concurrent, 5 min timeout.",
		inputSchema,
		execute: async (
			{ prompt, systemPrompt, provider }: z.infer<typeof inputSchema>,
			options?: { abortSignal?: AbortSignal },
		) => {
			const parentSignal = options?.abortSignal;

			const current = depthStorage.getStore();
			const depth = current?.depth ?? 0;
			if (depth >= MAX_DEPTH) {
				return {
					success: false,
					error: `Max subagent depth (${MAX_DEPTH}) exceeded. Cannot dispatch from a grandchild agent.`,
				};
			}

			await semaphore.acquire();
			const started = Date.now();
			const timeoutCtrl = new AbortController();
			const linkedSignal = parentSignal
				? AbortSignal.any([parentSignal, timeoutCtrl.signal])
				: timeoutCtrl.signal;
			const timer = setTimeout(() => timeoutCtrl.abort(), TIMEOUT_MS);

			try {
				const factory = new AgentFactory(config);
				const { agent } = await factory.createHeadless({
					systemPrompt: systemPrompt ?? DEFAULT_SUBAGENT_PROMPT,
					provider,
					allowedToolGroups: DEFAULT_ALLOWED_TOOL_GROUPS,
				});

				const result = await depthStorage.run({ depth: depth + 1 }, () =>
					agent.generate({
						messages: [{ role: "user", content: prompt }],
						abortSignal: linkedSignal,
					}),
				);

				logger.debug(
					`[subagent] depth=${depth + 1} provider=${provider ?? "default"} ` +
						`prompt="${prompt.slice(0, 100).replace(/\s+/g, " ")}" ` +
						`duration=${Date.now() - started}ms steps=${result.steps.length} success=true`,
				);
				return { success: true, text: result.text };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);

				// Parent triggered abort → let it propagate. Don't swallow into
				// a structured error; the parent's ToolLoopAgent should terminate.
				if (parentSignal?.aborted) {
					throw err;
				}

				// Timeout
				if (timeoutCtrl.signal.aborted) {
					logger.warn(`[subagent] timeout after ${TIMEOUT_MS}ms`);
					return {
						success: false,
						error: `Subagent timed out after ${TIMEOUT_MS / 1000}s`,
					};
				}

				logger.warn(`[subagent] failed: ${message}`);
				return { success: false, error: `Subagent failed: ${message}` };
			} finally {
				clearTimeout(timer);
				semaphore.release();
			}
		},
	});

	return { subagent: subagentTool };
}
```

**Notes for the implementer:**
- `AgentFactory` is imported from `../agent/factory`. There's a potential circular concern: factory imports from `../tools`, and this file lives in `../tools`. Verify `resolveTools` does NOT eagerly import `subagent.ts` at module load — it loads lazily via the switch case (Task 3). If Bun's ESM ordering causes issues during the first dev run, moving the `AgentFactory` import to a dynamic `import("../agent/factory")` inside `execute()` is a valid fallback.
- The tool registration key is `"subagent"` (matches the tool group name in Task 3).
- `AbortSignal.any()` requires Node 20+ / Bun 1.x — both fine for this project.

---

- [ ] **Step 2.2: Typecheck**

Run: `bun run typecheck`

Expected: Exits 0. If circular import manifests as a type error, switch to dynamic import as noted above.

---

- [ ] **Step 2.3: Lint/format**

Run: `bun run check`

Expected: Exits 0.

---

- [ ] **Step 2.4: Commit**

```bash
git add packages/core/src/tools/subagent.ts
git commit -m "feat(core/tools): add subagent tool with depth and concurrency limits"
```

---

## Task 3: Register `subagent` group in `resolveTools`

**Files:**
- Modify: `packages/core/src/tools/index.ts`

---

- [ ] **Step 3.1: Add import**

Near the other tool imports (around lines 10-21 in `packages/core/src/tools/index.ts`), add:

```ts
import { createSubagentTools, SUBAGENT_TOOL_GUIDE } from "./subagent";
```

---

- [ ] **Step 3.2: Add `"subagent"` to `ALL_TOOL_GROUPS`**

Append to the exported `ALL_TOOL_GROUPS` tuple (from Task 1.1):

```ts
export const ALL_TOOL_GROUPS = [
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
	"subagent",
] as const;
```

(Just add `"subagent"` as the last entry before `] as const`.)

---

- [ ] **Step 3.3: Add switch case for `subagent`**

Inside `resolveTools`, find the `switch (group)` block and add a case (anywhere inside it; suggest right after the `case "memory"` block):

```ts
			case "subagent": {
				Object.assign(tools, createSubagentTools(config ?? ({} as OpenMantisConfig)));
				guides.push(SUBAGENT_TOOL_GUIDE);
				break;
			}
```

**Notes:**
- `config` is typed as `OpenMantisConfig | undefined` in `resolveTools`. The subagent tool needs a real config (it instantiates `AgentFactory` which requires one). If `config` is `undefined` at this point, something upstream is wrong — but we guard with `?? ({} as OpenMantisConfig)` to match the nullable signature. If the implementer prefers, add a `logger.warn(...)` + `break` instead when config is missing.

---

- [ ] **Step 3.4: Add re-export at bottom**

In the existing re-export block at the bottom of `index.ts`, add:

```ts
export { createSubagentTools } from "./subagent";
```

---

- [ ] **Step 3.5: Typecheck**

Run: `bun run typecheck`

Expected: Exits 0.

---

- [ ] **Step 3.6: Lint/format**

Run: `bun run check`

Expected: Exits 0.

---

- [ ] **Step 3.7: Commit**

```bash
git add packages/core/src/tools/index.ts
git commit -m "feat(core/tools): register subagent group in resolveTools"
```

---

## Task 4: Manual smoke test

**Goal:** Confirm the 7 behaviors from the spec's Verification section. No automated tests — the author runs these by hand and records results.

**Setup:** In one terminal: `bun run dev` (watch mode with `LOG_LEVEL=debug`).
Trigger the subagent by messaging the channel with prompts crafted to elicit the behavior.

---

- [ ] **Scenario 1: Single call returns normally**

Prompt to parent agent:
> 调用 subagent 让它返回 "hello from subagent"，然后把结果原样告诉我。

Expected:
- Log contains `[subagent] depth=1 provider=<default> prompt="..." duration=<Xms> steps=<N> success=true`
- Parent reply echoes "hello from subagent"

---

- [ ] **Scenario 2: Parallel fan-out**

Prompt:
> 同时派发 3 个 subagent：一个算 2+2，一个说今天星期几，一个返回 "C"。**必须在一条消息里同时发起 3 个 subagent 调用**，不要串行。然后把 3 个结果一起告诉我。

Expected:
- Log shows 3 `[subagent] depth=1 ...` entries with **overlapping timestamps** (start times within <1s of each other)
- Total wall-clock time for the 3 ≈ the slowest one (not sum)

---

- [ ] **Scenario 3: Timeout (300s)**

Prompt:
> 派发一个 subagent，要求它在 bash 里执行 `sleep 500` 然后返回。

Expected:
- After ~300s, parent receives `{ success: false, error: "Subagent timed out after 300s" }`
- Log: `[subagent] timeout after 300000ms`
- Bash process should be reaped (check `ps aux | grep sleep` — no orphan)

---

- [ ] **Scenario 4: Depth limit**

Prompt:
> 派发一个 subagent，让它自己再派发一个 subagent，让那个孙 subagent 也再派发一个 subagent（共 3 层）。把最深层的结果告诉我。

Expected:
- Child (depth=1) and grandchild (depth=2) succeed
- Great-grandchild attempt fails with: `{ success: false, error: "Max subagent depth (2) exceeded. ..." }`
- Log shows depth=1 and depth=2 entries, but no depth=3

---

- [ ] **Scenario 5: Parent interrupt propagates**

Prompt:
> 派发一个 subagent，让它在 bash 里 `sleep 60`。

During the 60s window, type `/stop` (or the project's interrupt mechanism) to cancel the parent.

Expected:
- Parent stops
- Log does NOT show a stuck subagent step; the subagent's bash is killed promptly
- No `timed out` log entry (the cancellation wins before TIMEOUT_MS)

---

- [ ] **Scenario 6: Tool isolation**

Prompt:
> 派发一个 subagent，让它用 memory_core_upsert 工具写一条记忆。

Expected:
- Subagent reports that `memory_core_upsert` is not available (the tool is not in its registry)
- Parent's memory remains unchanged — run `cat .openmantis/memory/...` before and after, diff empty

---

- [ ] **Scenario 7: Provider override**

Prompt (requires at least 2 providers configured):
> 派发一个 subagent，使用 provider="<alternate-provider-name>"，让它说一下它用的是什么模型。

Expected:
- Log: `[subagent] depth=1 provider=<alternate-provider-name> ...`
- Subagent response confirms the alternate model (if the model's self-identification is reliable)

---

- [ ] **Step 4.8: Done**

If all 7 scenarios pass, the feature is complete. Any failure → file an issue / fix in a follow-up commit (no blocking commit needed for this task since no code changes).

---

## Summary

| Task | Files Touched | Commits |
|---|---|---|
| 1 | `factory.ts`, `tools/index.ts` | 1 |
| 2 | `tools/subagent.ts` (new) | 1 |
| 3 | `tools/index.ts` | 1 |
| 4 | (none — manual) | 0 |

**Total: 3 commits, ~200 lines of net code added.**
