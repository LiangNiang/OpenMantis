# Xiaomi MiMo TTS v2.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 OpenMantis 的 TTS provider 从 `mimo-v2-tts` 切到 `mimo-v2.5-tts`，用 9 个新音色、官方 `(xx)` 风格语法，并新增 `direction`（自然语言表演指导）字段。

**Architecture:** `style` 前缀拼接下沉到 provider（成为 v2.5 语法唯一源头）；tool / gateway 只传结构化字段；新增的 `direction` 走 `role: user` 消息；共享 `SynthesizeOptions` / `SynthesizeStreamOptions` 类型在 `@openmantis/common/types/tts` 对齐，xiaomi provider 不再维护重复类型定义。

**Tech Stack:** Bun, TypeScript, Zod, Vercel AI SDK v6, React 19 + shadcn/ui

**Deviation from skill default:** 项目无测试套件（user preference in memory）。本计划用 `bun run typecheck` + 手动冒烟替代 TDD 循环。每个任务只做一次 `typecheck`，失败则同步修复再 commit。

**Spec reference:** `resources/specs/2026-04-23-xiaomi-mimo-tts-v2.5-design.md`

---

## File Structure

| 文件 | 职责 | 操作 |
|---|---|---|
| `packages/common/src/config/schema.ts` | Zod config 校验 | 新增 `direction` 字段 |
| `packages/common/src/types/tts.ts` | TTS 共享类型 | `user` → `style`/`direction`（两个 interface） |
| `packages/tts/src/providers/xiaomi.ts` | Xiaomi TTS provider 实现 | 换 model、重写 `buildMessages`、style fallback 下沉、删本地类型 |
| `packages/tts/src/index.ts` | TTS 包 barrel | 类型 re-export 源切到 common |
| `packages/core/src/tools/tts.ts` | Agent 可调用的 TTS tool | input schema 加 `direction`、execute 简化、description 重写 |
| `packages/core/src/gateway/gateway.ts` | Auto-TTS 触发器 | 删 `<style>...</style>${text}` 拼接 |
| `packages/web/src/i18n/locales/zh.json` | 中文 i18n | 删旧音色 key、加 direction key |
| `packages/web/src/i18n/locales/en.json` | 英文 i18n | 同上 |
| `packages/web/src/components/tools-form.tsx` | Web 设置页 tools 表单 | 替换音色列表、扩充风格预设、加 direction textarea、修渲染逻辑 |

依赖顺序（任务按此排）：**schema → common types → provider + barrel → tool → gateway → i18n → UI → 全局验证**。

---

## Task 1: Add `direction` field to config schema

**Files:**
- Modify: `packages/common/src/config/schema.ts:51-58`

- [ ] **Step 1: Edit** — 在 `xiaomiTtsConfigSchema` 里 `style` 后插入 `direction`

```ts
// old_string:
const xiaomiTtsConfigSchema = z.object({
	enabled: z.boolean().default(false),
	apiKey: z.string().optional(),
	baseUrl: z.string().optional(),
	voice: z.string().default("mimo_default"),
	style: z.string().optional(),
	stream: z.boolean().default(true),
});

// new_string:
const xiaomiTtsConfigSchema = z.object({
	enabled: z.boolean().default(false),
	apiKey: z.string().optional(),
	baseUrl: z.string().optional(),
	voice: z.string().default("mimo_default"),
	style: z.string().optional(),
	direction: z.string().optional(),
	stream: z.boolean().default(true),
});
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS（只加了可选字段，不会破坏现有类型）

- [ ] **Step 3: Commit**

```bash
git add packages/common/src/config/schema.ts
git commit -m "feat(common): add xiaomiTts.direction config field"
```

---

## Task 2: Update shared TTS option types

**Files:**
- Modify: `packages/common/src/types/tts.ts:3-20`

- [ ] **Step 1: Edit** — `SynthesizeOptions` 和 `SynthesizeStreamOptions` 同时把 `user` 换成 `style` / `direction`

```ts
// old_string:
export interface SynthesizeOptions {
	text: string;
	voice?: string;
	user?: string;
}

export interface SynthesizeResult {
	filePath: string;
	format: "wav";
	bytes: number;
	durationMs: number;
}

export interface SynthesizeStreamOptions {
	text: string;
	voice?: string;
	user?: string;
}

// new_string:
export interface SynthesizeOptions {
	text: string;
	voice?: string;
	style?: string;
	direction?: string;
}

export interface SynthesizeResult {
	filePath: string;
	format: "wav";
	bytes: number;
	durationMs: number;
}

export interface SynthesizeStreamOptions {
	text: string;
	voice?: string;
	style?: string;
	direction?: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS。理由：`xiaomi.ts` 有自己的本地 `SynthesizeOptions`、gateway 只传 `{text}`、tool 目前没有传 `user`——这三处都不会受 common 类型变动影响。

- [ ] **Step 3: Commit**

```bash
git add packages/common/src/types/tts.ts
git commit -m "refactor(common): replace user with style/direction in tts option types"
```

---

## Task 3: Rewrite Xiaomi provider + fix barrel

**Files:**
- Modify: `packages/tts/src/providers/xiaomi.ts`（整体重写 L11-L143 区段）
- Modify: `packages/tts/src/index.ts:3-8`

- [ ] **Step 1: Edit `xiaomi.ts`** — 用 common 类型、硬编码 v2.5 model、`buildMessages` 接 style/direction、options→config fallback

替换文件头部区段（常量 + 本地类型定义）：

```ts
// old_string:
import type { TtsProvider } from "@openmantis/common/types/tts";
import { pcmChunksToWav } from "../pcm";
import type { TtsConfig } from "../types";

const logger = createLogger("tts");

const DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1";

export interface SynthesizeOptions {
	text: string;
	voice?: string;
	user?: string;
}

export interface SynthesizeResult {
	filePath: string;
	format: "wav";
	bytes: number;
	durationMs: number;
}

// new_string:
import type {
	SynthesizeOptions,
	SynthesizeResult,
	SynthesizeStreamOptions,
	TtsProvider,
} from "@openmantis/common/types/tts";
import { pcmChunksToWav } from "../pcm";
import type { TtsConfig } from "../types";

const logger = createLogger("tts");

const DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1";
const MODEL_ID = "mimo-v2.5-tts";
let streamCompatLogged = false;
```

- [ ] **Step 2: Edit `xiaomi.ts`** — 重写 `buildMessages`，删除旧的 user 版本

```ts
// old_string:
function buildMessages(text: string, user?: string) {
	const messages: Array<{ role: string; content: string }> = [];
	if (user) messages.push({ role: "user", content: user });
	messages.push({ role: "assistant", content: text });
	return messages;
}

// new_string:
function buildMessages(text: string, style?: string, direction?: string) {
	const messages: Array<{ role: string; content: string }> = [];
	if (direction) messages.push({ role: "user", content: direction });
	const content = style ? `(${style})${text.trimStart()}` : text;
	messages.push({ role: "assistant", content });
	return messages;
}
```

- [ ] **Step 3: Edit `xiaomi.ts`** — `synthesize` 重写（model / fallback / buildMessages 接线），并删除本地 `SynthesizeOptions` 定义段

```ts
// old_string:
export async function synthesize(
	options: SynthesizeOptions,
	config?: TtsConfig,
): Promise<SynthesizeResult> {
	const { apiKey, baseUrl } = resolveCreds(config);
	const voice = options.voice ?? config?.xiaomiTts?.voice ?? "mimo_default";

	logger.debug(
		`[tts] synthesize request: voice=${voice}, textLen=${options.text.length}, baseUrl=${baseUrl}, text=${JSON.stringify(options.text)}`,
	);

	const startMs = Date.now();
	const res = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"api-key": apiKey,
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "mimo-v2-tts",
			messages: buildMessages(options.text, options.user),
			audio: { format: "wav", voice },
		}),
	});

// new_string:
export async function synthesize(
	options: SynthesizeOptions,
	config?: TtsConfig,
): Promise<SynthesizeResult> {
	const { apiKey, baseUrl } = resolveCreds(config);
	const voice = options.voice ?? config?.xiaomiTts?.voice ?? "mimo_default";
	const style = options.style ?? config?.xiaomiTts?.style;
	const direction = options.direction ?? config?.xiaomiTts?.direction;

	logger.debug(
		`[tts] synthesize request: voice=${voice}, textLen=${options.text.length}, style=${style ?? "(none)"}, direction=${direction ? "(set)" : "(none)"}, baseUrl=${baseUrl}`,
	);

	const startMs = Date.now();
	const res = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"api-key": apiKey,
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: MODEL_ID,
			messages: buildMessages(options.text, style, direction),
			audio: { format: "wav", voice },
		}),
	});
```

- [ ] **Step 4: Edit `xiaomi.ts`** — `synthesizeStream` 同类改造 + 流式兼容模式一次性日志，并删除本地 `SynthesizeStreamOptions`

```ts
// old_string:
export interface SynthesizeStreamOptions {
	text: string;
	voice?: string;
	user?: string;
}

/**
 * Stream pcm16 audio from Xiaomi MIMO TTS, materialize into a WAV file
 * once the stream completes. Returns the file path.
 */
export async function synthesizeStream(
	options: SynthesizeStreamOptions,
	config?: TtsConfig,
): Promise<SynthesizeResult> {
	const { apiKey, baseUrl } = resolveCreds(config);
	const voice = options.voice ?? config?.xiaomiTts?.voice ?? "mimo_default";

	logger.debug(
		`[tts] synthesize stream request: voice=${voice}, textLen=${options.text.length}, baseUrl=${baseUrl}`,
	);

	const startMs = Date.now();
	const res = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"api-key": apiKey,
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		},
		body: JSON.stringify({
			model: "mimo-v2-tts",
			messages: buildMessages(options.text, options.user),
			audio: { format: "pcm16", voice },
			stream: true,
		}),
	});

// new_string:
/**
 * Stream pcm16 audio from Xiaomi MIMO TTS, materialize into a WAV file
 * once the stream completes. Returns the file path.
 *
 * Note: v2.5-tts streaming currently runs in compatibility mode (server emits
 * the full buffer once all inference completes), so there is no first-byte
 * latency advantage over non-streaming. API shape is unchanged.
 */
export async function synthesizeStream(
	options: SynthesizeStreamOptions,
	config?: TtsConfig,
): Promise<SynthesizeResult> {
	const { apiKey, baseUrl } = resolveCreds(config);
	const voice = options.voice ?? config?.xiaomiTts?.voice ?? "mimo_default";
	const style = options.style ?? config?.xiaomiTts?.style;
	const direction = options.direction ?? config?.xiaomiTts?.direction;

	if (!streamCompatLogged) {
		logger.info(
			"[tts] v2.5-tts streaming runs in compatibility mode — no first-byte latency improvement over non-stream",
		);
		streamCompatLogged = true;
	}

	logger.debug(
		`[tts] synthesize stream request: voice=${voice}, textLen=${options.text.length}, style=${style ?? "(none)"}, direction=${direction ? "(set)" : "(none)"}, baseUrl=${baseUrl}`,
	);

	const startMs = Date.now();
	const res = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"api-key": apiKey,
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		},
		body: JSON.stringify({
			model: MODEL_ID,
			messages: buildMessages(options.text, style, direction),
			audio: { format: "pcm16", voice },
			stream: true,
		}),
	});
```

- [ ] **Step 5: Edit `packages/tts/src/index.ts`** — barrel 的类型导出源切到 common

```ts
// old_string:
export type {
	SynthesizeOptions,
	SynthesizeResult,
	SynthesizeStreamOptions,
} from "./providers/xiaomi";
export { synthesize, synthesizeStream } from "./providers/xiaomi";

// new_string:
export type {
	SynthesizeOptions,
	SynthesizeResult,
	SynthesizeStreamOptions,
} from "@openmantis/common/types/tts";
export { synthesize, synthesizeStream } from "./providers/xiaomi";
```

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/tts/src/providers/xiaomi.ts packages/tts/src/index.ts
git commit -m "feat(tts): switch xiaomi provider to mimo-v2.5-tts with (xx) style syntax"
```

---

## Task 4: Update TTS tool — input schema, description, execute

**Files:**
- Modify: `packages/core/src/tools/tts.ts:16-84`

- [ ] **Step 1: Edit** — 整段重写 tool 定义

```ts
// old_string:
	return {
		tts_speak: tool({
			description:
				"使用小米 MiMo TTS 合成语音。生成的 WAV 文件保存到 .openmantis/tts/，若当前会话来自飞书或企业微信会自动作为语音消息发送。\n\n文本支持两种富表达：\n1. 整体风格：在文本最开头放 <style>风格名</style>，如 <style>开心</style>、<style>东北话</style>、<style>唱歌</style>。多个风格可放在同一标签内空格分隔。\n2. 细粒度音频标签：在文本任意位置插入中文括号标签控制语气、动作、语速等，如：（紧张，深呼吸）、（小声）、（咳嗽）、（长叹一口气）、（语速加快）、（苦笑）、（提高音量喊话）、（沉默片刻）。可与 <style> 组合。\n\n示例：<style>开心</style>（小声）告诉你一个秘密哦……（语速加快）我中奖啦！",
			inputSchema: z.object({
				text: z.string().describe("要合成的文本，最长 2000 字符"),
				voice: z
					.string()
					.optional()
					.describe("音色名（mimo_default / default_zh / default_en），不填使用配置默认"),
				style: z
					.string()
					.optional()
					.describe("风格标签（如 开心、东北话、唱歌），会以 <style>...</style> 形式插入文本开头"),
				stream: z.boolean().optional().describe("是否使用流式 pcm16 合成，默认 false"),
			}),
			execute: async ({ text, voice, style, stream }) => {
				logger.debug(
					`[tool:tts] called: textLen=${text.length}, voice=${voice ?? "(default)"}, style=${style ?? "(none)"}, stream=${stream ?? false}, text=${JSON.stringify(text)}`,
				);
				const trimmed = text.trim();
				if (!trimmed) return { error: "text 不能为空" };
				if (trimmed.length > MAX_TEXT_LEN) {
					return { error: `text 长度 ${trimmed.length} 超过上限 ${MAX_TEXT_LEN}` };
				}

				const effectiveStyle = style ?? config.xiaomiTts?.style;
				const finalText = effectiveStyle ? `<style>${effectiveStyle}</style>${trimmed}` : trimmed;

				try {
					const result = stream
						? await synthesizeStream({ text: finalText, voice }, config)
						: await synthesize({ text: finalText, voice }, config);

// new_string:
	return {
		tts_speak: tool({
			description:
				"使用小米 MiMo v2.5-TTS 合成语音。生成的 WAV 保存到 .openmantis/tts/，飞书/企微会话会自动作为语音消息发送。\n\n三种风格控制方式（可组合）：\n- style：短风格标签，会拼成 `(xx)` 前缀。例：开心、慵懒、东北话、夹子音、孙悟空、唱歌。多个用空格分隔。\n- direction（可选）：自然语言表演指导，适合段落级情感刻画和\"角色/场景/指导\"导演模式。\n- 文本内细粒度标签：在 text 任意位置插入中文括号标签，如（紧张，深呼吸）、（咳嗽）、（语速加快）、（苦笑）、（小声）。可与 style 组合。\n\n示例：style=\"开心\" text=\"（小声）告诉你一个秘密哦……（语速加快）我中奖啦！\"",
			inputSchema: z.object({
				text: z.string().describe("要合成的文本，最长 2000 字符"),
				voice: z
					.string()
					.optional()
					.describe(
						"音色名：mimo_default（集群默认，中国→冰糖、海外→Mia）/ 冰糖 / 茉莉 / 苏打 / 白桦（中文）/ Mia / Chloe / Milo / Dean（英文）。不填使用配置默认。",
					),
				style: z
					.string()
					.optional()
					.describe(
						"短风格标签（如 开心、东北话、唱歌），会拼成 (风格) 前缀插到文本开头。多个标签用空格分隔。",
					),
				direction: z
					.string()
					.optional()
					.describe(
						"自然语言表演指导（可选），会以 user message 传给模型。例：用轻快上扬的语调、语速稍快。支持'角色/场景/指导'三段式导演模式。",
					),
				stream: z
					.boolean()
					.optional()
					.describe("是否使用流式合成，默认 false。注意 v2.5 流式目前为兼容模式，无首字延迟收益。"),
			}),
			execute: async ({ text, voice, style, direction, stream }) => {
				logger.debug(
					`[tool:tts] called: textLen=${text.length}, voice=${voice ?? "(default)"}, style=${style ?? "(none)"}, direction=${direction ? "(set)" : "(none)"}, stream=${stream ?? false}, text=${JSON.stringify(text)}`,
				);
				const trimmed = text.trim();
				if (!trimmed) return { error: "text 不能为空" };
				if (trimmed.length > MAX_TEXT_LEN) {
					return { error: `text 长度 ${trimmed.length} 超过上限 ${MAX_TEXT_LEN}` };
				}

				try {
					const opts = { text: trimmed, voice, style, direction };
					const result = stream
						? await synthesizeStream(opts, config)
						: await synthesize(opts, config);
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/tts.ts
git commit -m "feat(core/tools): expose direction arg and v2.5 style syntax in tts_speak"
```

---

## Task 5: Clean gateway auto-TTS

**Files:**
- Modify: `packages/core/src/gateway/gateway.ts:153-166`

- [ ] **Step 1: Edit** — 删除 step 6 的 `<style>` 注入段、合并 step 7、日志扩充 direction 标志

```ts
// old_string:
	// 6. style injection (provider-specific config still lives in xiaomiTts for now)
	const styledText = config.xiaomiTts?.style
		? `<style>${config.xiaomiTts.style}</style>${text}`
		: text;

	// 7. synthesize + upload
	try {
		const useStream = config.xiaomiTts?.stream ?? true;
		logger.info(
			`[gateway] auto-tts triggered: channel=${channel.channelType}, provider=${provider.name}, textLen=${text.length}, stream=${useStream}, style=${config.xiaomiTts?.style ?? "(none)"}`,
		);
		const result = useStream
			? await provider.synthesizeStream({ text: styledText }, config)
			: await provider.synthesize({ text: styledText }, config);

// new_string:
	// 6. synthesize + upload (style / direction resolved inside provider via config fallback)
	try {
		const useStream = config.xiaomiTts?.stream ?? true;
		logger.info(
			`[gateway] auto-tts triggered: channel=${channel.channelType}, provider=${provider.name}, textLen=${text.length}, stream=${useStream}, style=${config.xiaomiTts?.style ?? "(none)"}, direction=${config.xiaomiTts?.direction ? "(set)" : "(none)"}`,
		);
		const result = useStream
			? await provider.synthesizeStream({ text }, config)
			: await provider.synthesize({ text }, config);
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/gateway/gateway.ts
git commit -m "refactor(core/gateway): drop legacy style prefix injection in auto-tts"
```

---

## Task 6: Update i18n locale files

**Files:**
- Modify: `packages/web/src/i18n/locales/zh.json:147-149`
- Modify: `packages/web/src/i18n/locales/en.json:147-149`

- [ ] **Step 1: Edit `zh.json`** — 删掉两个 default_zh/en 条目、插入 direction 三个 key

```json
// old_string:
	"xiaomiTts.voiceMimoDefault": "MIMO 默认",
	"xiaomiTts.voiceDefaultZh": "中文默认",
	"xiaomiTts.voiceDefaultEn": "英文默认",
	"xiaomiTts.stream": "流式输出",

// new_string:
	"xiaomiTts.voiceMimoDefault": "MIMO 默认",
	"xiaomiTts.direction.label": "默认表演指导",
	"xiaomiTts.direction.placeholder": "用轻快上扬的语调、语速稍快…",
	"xiaomiTts.direction.helper": "可选的一段自然语言表演指导（作为 user message 传给模型）。应用于自动 TTS；tool 通过 direction 参数可 override。支持'角色/场景/指导'三段式。",
	"xiaomiTts.stream": "流式输出",
```

- [ ] **Step 2: Edit `en.json`** — 同位置

```json
// old_string:
	"xiaomiTts.voiceMimoDefault": "MIMO Default",
	"xiaomiTts.voiceDefaultZh": "Chinese Default",
	"xiaomiTts.voiceDefaultEn": "English Default",
	"xiaomiTts.stream": "Streaming",

// new_string:
	"xiaomiTts.voiceMimoDefault": "MIMO Default",
	"xiaomiTts.direction.label": "Default direction",
	"xiaomiTts.direction.placeholder": "e.g. Bright, bouncy tone, fast pace…",
	"xiaomiTts.direction.helper": "Optional natural-language performance guidance (sent as user message). Applied to auto-TTS; the tool can override via the direction arg. Supports role/scene/direction three-part director mode.",
	"xiaomiTts.stream": "Streaming",
```

- [ ] **Step 3: JSON 合法性检查**

Run: `bun -e "JSON.parse(Bun.file('packages/web/src/i18n/locales/zh.json').readerSync ? require('fs').readFileSync('packages/web/src/i18n/locales/zh.json','utf8') : '')" && bun -e "JSON.parse(require('fs').readFileSync('packages/web/src/i18n/locales/en.json','utf8'))"`

更简洁的替代：

Run: `node -e "JSON.parse(require('fs').readFileSync('packages/web/src/i18n/locales/zh.json','utf8'));JSON.parse(require('fs').readFileSync('packages/web/src/i18n/locales/en.json','utf8'));console.log('ok')"`

Expected: 输出 `ok`（任何 `SyntaxError` 表示 JSON 被破坏需要修复）

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/i18n/locales/zh.json packages/web/src/i18n/locales/en.json
git commit -m "feat(web/i18n): swap voice default keys for direction keys"
```

---

## Task 7: Update Web form — voice list, style presets, direction field, render

**Files:**
- Modify: `packages/web/src/components/tools-form.tsx`

- [ ] **Step 1: Edit** — 加 Textarea 导入（如现有 import 块内没有）

在文件顶部 import 区域（已有 `import { Input } from ".../input"` 等的地方）加一行：

```ts
import { Textarea } from "@/components/ui/textarea";
```

（若文件的 import 已经包含 Textarea，跳过此步。）

- [ ] **Step 2: Edit `DEFAULT_XIAOMI_TTS`（L46-L51）**

```ts
// old_string:
const DEFAULT_XIAOMI_TTS = {
	enabled: false,
	voice: "mimo_default",
	style: "",
	stream: true,
};

// new_string:
const DEFAULT_XIAOMI_TTS = {
	enabled: false,
	voice: "mimo_default",
	style: "",
	direction: "",
	stream: true,
};
```

- [ ] **Step 3: Edit `XIAOMI_TTS_VOICES`（L53-L57）**

```ts
// old_string:
const XIAOMI_TTS_VOICES = [
	{ value: "mimo_default", labelKey: "xiaomiTts.voiceMimoDefault" },
	{ value: "default_zh", labelKey: "xiaomiTts.voiceDefaultZh" },
	{ value: "default_en", labelKey: "xiaomiTts.voiceDefaultEn" },
];

// new_string:
const XIAOMI_TTS_VOICES: Array<{ value: string; labelKey?: string }> = [
	{ value: "mimo_default", labelKey: "xiaomiTts.voiceMimoDefault" },
	{ value: "冰糖" },
	{ value: "茉莉" },
	{ value: "苏打" },
	{ value: "白桦" },
	{ value: "Mia" },
	{ value: "Chloe" },
	{ value: "Milo" },
	{ value: "Dean" },
];
```

- [ ] **Step 4: Edit `XIAOMI_TTS_STYLE_PRESETS`（L59-L65）**

```ts
// old_string:
const XIAOMI_TTS_STYLE_PRESETS = [
	"开心", "悲伤", "生气",
	"变快", "变慢",
	"悄悄话", "夹子音", "台湾腔",
	"东北话", "四川话", "河南话", "粤语",
	"孙悟空", "林黛玉",
];

// new_string:
const XIAOMI_TTS_STYLE_PRESETS = [
	// 基础情绪
	"开心", "悲伤", "愤怒", "惊讶", "兴奋", "平静",
	// 复合情绪
	"怅然", "欣慰", "无奈", "释然",
	// 整体语调
	"温柔", "高冷", "活泼", "严肃", "慵懒",
	// 音色定位
	"磁性", "醇厚", "清亮", "甜美", "沙哑",
	// 人设腔调
	"夹子音", "御姐音", "正太音", "大叔音", "台湾腔",
	// 方言
	"东北话", "四川话", "河南话", "粤语",
	// 角色扮演
	"孙悟空", "林黛玉",
	// 唱歌
	"唱歌",
];
```

- [ ] **Step 5: Edit voice select 渲染逻辑（L206-L210）**

`XIAOMI_TTS_VOICES` 条目的 `labelKey` 变为可选，渲染要兜底。

```tsx
// old_string:
									{XIAOMI_TTS_VOICES.map((v) => (
										<SelectItem key={v.value} value={v.value}>
											{t(v.labelKey)}
										</SelectItem>
									))}

// new_string:
									{XIAOMI_TTS_VOICES.map((v) => (
										<SelectItem key={v.value} value={v.value}>
											{v.labelKey ? t(v.labelKey) : v.value}
										</SelectItem>
									))}
```

- [ ] **Step 6: Edit** — 在 style 卡片块（以 `{t("xiaomiTts.style.label")}` 开头）之后、stream 开关（`{t("xiaomiTts.stream")}`）之前插入 direction textarea

定位锚点：当前代码在 L240-L241 结尾是 `</div>\n\t\t\t\t\t\t\t</div>`（关闭 style 外层），紧接 L242 是 `<div className="flex items-center justify-between">` 开头 stream 行。

```tsx
// old_string:
							</div>
						</div>
						<div className="flex items-center justify-between">
							<div>
								<Label>{t("xiaomiTts.stream")}</Label>

// new_string:
							</div>
						</div>
						<div className="flex flex-col gap-2">
							<Label>{t("xiaomiTts.direction.label")}</Label>
							<p className="text-xs text-muted-foreground">{t("xiaomiTts.direction.helper")}</p>
							<Textarea
								value={values.xiaomiTts?.direction ?? ""}
								placeholder={t("xiaomiTts.direction.placeholder")}
								onChange={(e) => updateXiaomiTts("direction", e.target.value)}
								rows={3}
							/>
						</div>
						<div className="flex items-center justify-between">
							<div>
								<Label>{t("xiaomiTts.stream")}</Label>
```

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/components/tools-form.tsx
git commit -m "feat(web): swap voice list and add direction textarea for xiaomi tts"
```

---

## Task 8: Global verification + manual smoke

**Files:** (verification only — no edits unless fixing regressions)

- [ ] **Step 1: Full typecheck**

Run: `bun run typecheck`
Expected: PASS across all packages

- [ ] **Step 2: Lint + format**

Run: `bun run check`
Expected: PASS (Biome 无 error；自动修复的 format 差异如有，接受并 `git commit --amend` 到最近一个 UI commit，或单独 commit `chore: apply biome autofix`)

- [ ] **Step 3: Dev 服务启动**

Run: `bun run dev:full`
Expected: 后端进程 + Vite dev server 都起来，无 stderr error。访问 Vite URL 应该能打开设置页。

- [ ] **Step 4: 手动冒烟（按顺序验证）**

配置前提：在 Web 设置页启用 Xiaomi TTS、填 apiKey、voice 选 `mimo_default`，保存。

1. **基础合成（non-stream）**：把 `xiaomiTts.stream` 关掉，飞书/企微频道触发一条回复（或让 agent 调用 `tts_speak`）。确认 `.openmantis/tts/` 下生成 WAV，能播放，是 v2.5 音质。
2. **流式合成**：`xiaomiTts.stream` 打开，重复。WAV 仍然可播；log 里应看到一次 `"v2.5-tts streaming runs in compatibility mode"` info。
3. **Style 生效**：设置页把 `style` 设为 `开心`，再触发。听到明显情绪上扬。
4. **Direction 生效**：设置页把 `direction` 设为一段描述（例如 `用慵懒、沙哑的低音，像是刚睡醒`），再触发。听到音色按描述调整；gateway log 应打 `direction=(set)`。
5. **新音色**：`voice` 切到 `冰糖`，再触发。应明显是女声中文音色。切到 `Dean` 再触发，应明显英文男声。
6. **Tool 调用**：让 agent 用 `tts_speak` 并 override `style` / `direction` / `voice`，确认 tool 层参数能覆盖 config。
7. **Web 设置页**：确认音色下拉 9 项齐全、`mimo_default` 显示为 "MIMO 默认"，其它按 value 原样；风格预设按分类展开且可以点选；direction textarea 能输入并保存。

- [ ] **Step 5: （若 Task 8 步骤 2 的 Biome 产生了自动格式化变更）commit**

```bash
git add -u
git commit -m "chore: apply biome autofix"
```

否则跳过此步。

---

## Self-Review 记录（written at plan creation time）

**Spec coverage**：
- Section 1 (Schema) → Task 1 ✓
- Section 2 (Provider + common types) → Task 2 + Task 3 ✓
- Section 3 (Tool) → Task 4 ✓
- Section 4 (Gateway) → Task 5 ✓
- Section 5 (Web UI) → Task 7（UI 改动） + Task 6（i18n key）✓
- 删除清单 → 分散在 Task 2/3/4/5/6/7 内 ✓
- 验证 → Task 8 ✓

**No-placeholder scan**：全部步骤含具体代码 / 命令；无 "TODO" / "TBD" / "implement appropriate xxx"。

**Type consistency**：
- `buildMessages(text, style, direction)` 签名在 Task 3 步骤 2/3/4 一致使用。
- `MODEL_ID` 常量在步骤 1 定义，步骤 3/4 引用。
- `SynthesizeOptions` 的 `style` / `direction` 字段在 Task 2 定义，Task 3 消费，Task 4 通过 opts 传入。
- i18n key `xiaomiTts.direction.label` / `.placeholder` / `.helper` 在 Task 6 定义，Task 7 Step 6 消费。

**Scope**：单一特性、单一 spec、单一发布边界。无需拆分。
