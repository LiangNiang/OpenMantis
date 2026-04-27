# DeepSeek Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DeepSeek as a first-class LLM provider type using the official `@ai-sdk/deepseek` package, exposed in the web settings UI with default base URL pre-filled.

**Architecture:** A `case "deepseek"` branch is added to the existing provider switch in `packages/core/src/agent/providers.ts`. It calls `createDeepSeek({ apiKey, baseURL })` from the official AI SDK package and returns a `LanguageModelV3`. The web provider form gains a new option in its `PROVIDER_TYPES` list and a default base URL in `PROVIDER_BASE_URLS`. No schema changes are needed (`provider: z.string()` is already open). No `thinking.ts` change is needed (DeepSeek's reasoning is determined by model id; `reasoningEffort` is intentionally ignored, falling into the existing default branch).

**Tech Stack:** Bun runtime · TypeScript · Vercel AI SDK v6 · `@ai-sdk/deepseek` v2.0.29 · React 19 + Vite (web)

**Spec:** `docs/superpowers/specs/2026-04-27-deepseek-provider-design.md`

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/core/package.json` | Modify | Add `@ai-sdk/deepseek` dependency |
| `packages/core/src/agent/providers.ts` | Modify | Add `case "deepseek"` branch in `createLanguageModel` |
| `packages/web/src/components/provider-form.tsx` | Modify | Add `deepseek` entry to `PROVIDER_TYPES` and `PROVIDER_BASE_URLS` |

No test files — `providers.ts` is a pure SDK wrapper consistent with existing untested provider branches; UI dropdown additions are verified via typecheck + manual smoke test.

---

## Task 1: Add `@ai-sdk/deepseek` dependency

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Install the dependency via bun**

Run from repo root:

```bash
(cd packages/core && bun add @ai-sdk/deepseek@^2.0.29)
```

This will:
- Add `"@ai-sdk/deepseek": "^2.0.29"` to `packages/core/package.json` under `dependencies`
- Update `bun.lock` at the repo root

- [ ] **Step 2: Verify the package was added correctly**

Run:

```bash
grep '"@ai-sdk/deepseek"' packages/core/package.json
```

Expected output (caret-version may differ slightly, that's fine):

```
		"@ai-sdk/deepseek": "^2.0.29",
```

Also confirm it appears in the lock:

```bash
grep -c "@ai-sdk/deepseek" bun.lock
```

Expected: `>= 1`.

- [ ] **Step 3: Verify imports resolve**

Create a temp script to confirm the SDK exports `createDeepSeek`:

```bash
bun --eval 'import("@ai-sdk/deepseek").then(m => console.log(typeof m.createDeepSeek))'
```

Expected output: `function`

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json bun.lock
git commit -m "build(core): add @ai-sdk/deepseek dependency"
```

---

## Task 2: Wire DeepSeek into the provider factory

**Files:**
- Modify: `packages/core/src/agent/providers.ts`

- [ ] **Step 1: Add the import**

At the top of `packages/core/src/agent/providers.ts`, add this import alongside the existing AI SDK imports (alphabetical order — place after `@ai-sdk/anthropic`):

Before (lines 1-5):

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ModelConfig, ProviderConfig } from "@openmantis/common/config/schema";
```

After:

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ModelConfig, ProviderConfig } from "@openmantis/common/config/schema";
```

- [ ] **Step 2: Add the `case "deepseek"` branch**

Insert this new branch in the `switch (providerConfig.provider)` statement. Place it directly after the `case "anthropic"` block (which ends at line 36 in the current file) and before the `case "xiaomi-mimo"` block. The new branch goes around what is currently line 37 (the blank line between the two existing cases):

```ts
		case "deepseek": {
			const deepseek = createDeepSeek({
				apiKey: providerConfig.apiKey,
				baseURL: providerConfig.baseUrl || undefined,
			});
			return deepseek(model);
		}
```

After insertion, the relevant slice of the file (anthropic → deepseek → xiaomi-mimo) should read:

```ts
		case "anthropic": {
			const anthropic = createAnthropic({
				apiKey: providerConfig.apiKey,
				baseURL: providerConfig.baseUrl || undefined,
			});
			return anthropic(model);
		}

		case "deepseek": {
			const deepseek = createDeepSeek({
				apiKey: providerConfig.apiKey,
				baseURL: providerConfig.baseUrl || undefined,
			});
			return deepseek(model);
		}

		case "xiaomi-mimo": {
```

Use tab indentation (the file uses tabs — match exactly).

- [ ] **Step 3: Run typecheck**

Run from repo root:

```bash
bun run typecheck
```

Expected: exit code 0, no errors. The return type of `createDeepSeek(...)(model)` must satisfy `LanguageModelV3`; `@ai-sdk/deepseek` v2.0.29 returns `LanguageModelV3` natively, so no cast is needed.

If typecheck fails complaining about `LanguageModelV3` mismatch: the SDK version in `bun.lock` is wrong — re-check Task 1.

- [ ] **Step 4: Run lint/format**

```bash
bun run check
```

Expected: exit code 0. Biome may auto-format the new block — let it.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent/providers.ts
git commit -m "feat(core): add DeepSeek provider via @ai-sdk/deepseek"
```

---

## Task 3: Expose DeepSeek in the web provider form

**Files:**
- Modify: `packages/web/src/components/provider-form.tsx`

- [ ] **Step 1: Add `deepseek` to `PROVIDER_TYPES`**

In `packages/web/src/components/provider-form.tsx`, locate the `PROVIDER_TYPES` array (currently lines 24-30):

Before:

```ts
const PROVIDER_TYPES = [
	{ value: "openai", label: "OpenAI" },
	{ value: "anthropic", label: "Anthropic" },
	{ value: "bytedance", label: "Bytedance (Doubao)" },
{ value: "xiaomi-mimo", label: "Xiaomi MIMO" },
	{ value: "openai-compatible", label: "OpenAI Compatible" },
];
```

After (add `deepseek` between `xiaomi-mimo` and `openai-compatible`, keeping `openai-compatible` last as the catch-all):

```ts
const PROVIDER_TYPES = [
	{ value: "openai", label: "OpenAI" },
	{ value: "anthropic", label: "Anthropic" },
	{ value: "bytedance", label: "Bytedance (Doubao)" },
{ value: "xiaomi-mimo", label: "Xiaomi MIMO" },
	{ value: "deepseek", label: "DeepSeek" },
	{ value: "openai-compatible", label: "OpenAI Compatible" },
];
```

Note: line 28 (`xiaomi-mimo` entry) currently has irregular indentation (no leading tab) — leave that as-is to minimize diff. The new `deepseek` line uses the standard tab-indent.

- [ ] **Step 2: Add the default base URL to `PROVIDER_BASE_URLS`**

Locate `PROVIDER_BASE_URLS` (currently lines 32-38):

Before:

```ts
const PROVIDER_BASE_URLS: Record<string, string> = {
	openai: "",
	anthropic: "",
	bytedance: "https://ark.cn-beijing.volces.com/api/v3",
"xiaomi-mimo": "https://api.xiaomimimo.com/v1",
	"openai-compatible": "",
};
```

After (add `deepseek` between `xiaomi-mimo` and `openai-compatible`):

```ts
const PROVIDER_BASE_URLS: Record<string, string> = {
	openai: "",
	anthropic: "",
	bytedance: "https://ark.cn-beijing.volces.com/api/v3",
"xiaomi-mimo": "https://api.xiaomimimo.com/v1",
	deepseek: "https://api.deepseek.com/v1",
	"openai-compatible": "",
};
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: exit code 0. (The `PROVIDER_BASE_URLS` is `Record<string, string>`, so adding a new key is structurally fine. `PROVIDER_TYPES` is an inferred tuple-of-objects, also fine.)

- [ ] **Step 4: Run lint/format**

```bash
bun run check
```

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/provider-form.tsx
git commit -m "feat(web): add DeepSeek to provider type dropdown"
```

---

## Task 4: Manual smoke test

This task has no automated steps — it verifies end-to-end correctness against the real DeepSeek API. The user (not the implementing agent) executes these steps and confirms they pass before merging.

**Files:**
- (none — verification only)

- [ ] **Step 1: Start dev server**

```bash
bun run dev:full
```

Expected: backend starts, Vite dev server prints a local URL (e.g. `http://localhost:5173`). Open it in a browser.

- [ ] **Step 2: Add a DeepSeek provider via the web UI**

In the dashboard's provider settings:

1. Click "Add provider" / 新增 provider
2. Set name: `deepseek-test`
3. Select provider type: **DeepSeek** (new option in dropdown)
4. Confirm `baseUrl` field is auto-populated with `https://api.deepseek.com/v1`
5. Paste a real DeepSeek API key
6. Add a model with id `deepseek-v4-flash`
7. Save

Expected: provider entry appears in the list with label "DeepSeek".

- [ ] **Step 3: Send a non-reasoning message via a configured channel**

Send a normal message to your test channel (e.g. Feishu) with `deepseek-test` set as the active provider (or via slash command if applicable). Examples:

- "你好，介绍一下你自己"

Expected: a coherent reply is returned in the channel within a few seconds.

- [ ] **Step 4: Switch to `deepseek-v4-pro` and test reasoning**

Edit the provider (or add a second model) and switch the active model id to `deepseek-v4-pro`. Send a message that benefits from reasoning, e.g.:

- "请一步步推理：一个袋子里有 3 个红球 5 个蓝球，随机摸 2 个，两个都是红球的概率是多少？"

Expected:
1. A reply with the answer is returned in the channel.
2. Inspect the runtime log (`tail -f $OPENMANTIS_DATA_DIR/openmantis.log` — for `bun run dev` this is `./.openmantis/openmantis.log`). You should see reasoning content streamed as `reasoning` parts (look for `reasoning` or `reasoning-delta` in the log when `LOG_LEVEL=debug`).

- [ ] **Step 5: Confirm error path**

Stop dev. Edit the saved config (or via UI) to use an invalid API key. Restart and send a message.

Expected: the channel receives an error message; the log shows an authentication-style error from the DeepSeek API. (No crash, no silent hang.)

Restore the valid API key after this check.

- [ ] **Step 6: No commit**

This task produces no code changes — nothing to commit.

---

## Final verification

After all three implementation tasks pass:

- [ ] Run full repo typecheck:

```bash
bun run typecheck
```

Expected: exit code 0.

- [ ] Run full repo lint/format:

```bash
bun run check
```

Expected: exit code 0.

- [ ] Confirm git log shows three clean commits:

```bash
git log --oneline -3
```

Expected (top to bottom):

```
<hash> feat(web): add DeepSeek to provider type dropdown
<hash> feat(core): add DeepSeek provider via @ai-sdk/deepseek
<hash> build(core): add @ai-sdk/deepseek dependency
```

- [ ] Confirm Task 4 (manual smoke test) was completed by the user.

Done. The DeepSeek provider is integrated.
