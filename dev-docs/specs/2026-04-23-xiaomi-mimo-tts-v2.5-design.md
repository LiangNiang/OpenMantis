# Xiaomi MiMo TTS v2.5 接入设计

**日期**：2026-04-23
**作用域**：仅 Mode A——预置音色合成（`mimo-v2.5-tts`）。不做 voicedesign / voiceclone。
**兼容策略**：不考虑老用户兼容。直接切换，删除 v2-tts 代码路径。

## 背景

小米 MiMo 推出 v2.5-TTS 系列，其中 `mimo-v2.5-tts` 作为预置音色模型是直接价值升级：

- 音色从 3 个（`mimo_default` / `default_zh` / `default_en`）扩展为 9 个（新增 8 个中英文具名音色）。
- 官方风格标签语法统一为 `(xx)` 前缀，配合文本内 `[音频标签]` 形成两级控制。
- 支持在 `role: user` 消息里放自然语言表演指导（"导演模式"），段落级情感刻画能力显著提升。
- 流式目前为兼容模式（全量生成后一次性 SSE 返回，无首字延迟收益），API 调用代码保持不变。

现状代码存在两处与 v2.5 不兼容的细节：

1. `packages/tts/src/providers/xiaomi.ts` 硬编码 `model: "mimo-v2-tts"`。
2. `packages/core/src/tools/tts.ts:42` 与 `packages/core/src/gateway/gateway.ts:154-156` 使用自定义 `<style>xx</style>` 前缀，v2.5 不是这个语法。

## 目标

- 将默认合成模型切换为 `mimo-v2.5-tts`。
- 将风格前缀语法切换为官方的 `(xx)`。
- 把 `style` 前缀拼接下沉到 provider，调用方只传结构化字段。
- 引入可选的 `direction` 字段（tool arg + config 字段），把 v2.5 的自然语言表演指导开放给 agent 和 auto-TTS。
- UI 音色下拉替换为 9 个新音色，风格预设扩充到覆盖 v2.5 文档全部 8 类。

## 非目标

- 不接入 `mimo-v2.5-tts-voicedesign` / `mimo-v2.5-tts-voiceclone`。
- 不引入 `model` 配置字段。provider 层硬编码单一模型。
- 不改 `TtsProvider` 接口（`synthesize` / `synthesizeStream` 的外部签名不动）。
- 不做向后兼容。旧的 `default_zh` / `default_en` 音色 ID、`<style>xx</style>` 语法、`mimo-v2-tts` 模型引用一律删除。
- 不接入音色试听、流式 tooltip、样本库等超出作用域的 UX 增强。

## 设计

### 1. 配置 Schema（`packages/common/src/config/schema.ts:51-58`）

```ts
const xiaomiTtsConfigSchema = z.object({
    enabled: z.boolean().default(false),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    voice: z.string().default("mimo_default"),
    style: z.string().optional(),
    direction: z.string().optional(),   // 新增
    stream: z.boolean().default(true),
});
```

仅新增一个字段 `direction`。语义：持久自然语言表演指导，供 auto-TTS 使用；tool 调用时 agent 也可通过同名参数 override。

`channelTtsSchema` 不变——`provider` 枚举仍是 `z.enum(["xiaomi-mimo"])`。

### 2. Provider 层（`packages/tts/src/providers/xiaomi.ts` + `packages/common/src/types/tts.ts`）

**共享类型同步**——`packages/common/src/types/tts.ts` 里现有的 `SynthesizeOptions` / `SynthesizeStreamOptions` 都带 `user?: string`，需要同步重塑。`TtsProvider` 接口定义本身（`name` / `synthesize` / `synthesizeStream` / `isConfigured`）不变，但参数 options 类型要更新：

```ts
// packages/common/src/types/tts.ts
export interface SynthesizeOptions {
    text: string;
    voice?: string;
    style?: string;      // 新增
    direction?: string;  // 新增（替换原 user 字段）
}

export interface SynthesizeStreamOptions {
    text: string;
    voice?: string;
    style?: string;      // 新增
    direction?: string;  // 新增（替换原 user 字段）
}
```

Xiaomi provider 里的本地 `SynthesizeOptions` / `SynthesizeStreamOptions` 删除（重复定义，直接从 common 引入）。

**常量**：

```ts
const MODEL_ID = "mimo-v2.5-tts";
const DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1";
```

**消息构造**：

```ts
function buildMessages(text: string, style?: string, direction?: string) {
    const messages: Array<{ role: string; content: string }> = [];
    if (direction) messages.push({ role: "user", content: direction });
    const content = style ? `(${style})${text.trimStart()}` : text;
    messages.push({ role: "assistant", content });
    return messages;
}
```

**Fallback 链**（`synthesize` / `synthesizeStream` 内）：

```ts
const voice     = options.voice     ?? config?.xiaomiTts?.voice ?? "mimo_default";
const style     = options.style     ?? config?.xiaomiTts?.style;
const direction = options.direction ?? config?.xiaomiTts?.direction;
```

`style` / `direction` / `voice` 统一遵循 "options 优先、config 兜底"。

**HTTP 请求**：

- `synthesize`：`model` → `MODEL_ID`，`messages` → 新 `buildMessages(text, style, direction)`。其余（headers、`audio.format = "wav"`、voice 字段、WAV 解码）不变。
- `synthesizeStream`：同上，只改 `model` 与 `messages`。SSE 解析、24kHz PCM→WAV 打包、`Accept: text/event-stream` 不动。

**日志**：`synthesizeStream` 首次调用时 `logger.info` 提醒 "v2.5-tts streaming runs in compatibility mode — no first-byte latency improvement over non-stream"。（避免用户误以为流式能降延迟。）

### 3. Tool 层（`packages/core/src/tools/tts.ts`）

**Input schema**：新增 `direction`，更新 `voice` / `style` / `stream` 的 description。

```ts
inputSchema: z.object({
    text: z.string().describe("要合成的文本，最长 2000 字符"),
    voice: z.string().optional()
        .describe("音色名：mimo_default（集群默认，中国→冰糖、海外→Mia）/ 冰糖 / 茉莉 / 苏打 / 白桦（中文）/ Mia / Chloe / Milo / Dean（英文）。不填使用配置默认。"),
    style: z.string().optional()
        .describe("短风格标签（如 开心、东北话、唱歌），会拼成 (风格) 前缀插到文本开头。多个标签用空格分隔。"),
    direction: z.string().optional()
        .describe("自然语言表演指导（可选），会以 user message 传给模型。例：用轻快上扬的语调、语速稍快。支持'角色/场景/指导'三段式导演模式。"),
    stream: z.boolean().optional()
        .describe("是否使用流式合成，默认 false。注意 v2.5 流式目前为兼容模式，无首字延迟收益。"),
}),
```

**Tool description 重写**：

```
使用小米 MiMo v2.5-TTS 合成语音。生成的 WAV 保存到 .openmantis/tts/，飞书/企微会话会自动作为语音消息发送。

三种风格控制方式（可组合）：
- style：短风格标签，会拼成 `(xx)` 前缀。例：开心、慵懒、东北话、夹子音、孙悟空、唱歌。多个用空格分隔。
- direction（可选）：自然语言表演指导，适合段落级情感刻画和"角色/场景/指导"导演模式。
- 文本内细粒度标签：在 text 任意位置插入中文括号标签，如（紧张，深呼吸）、（咳嗽）、（语速加快）、（苦笑）、（小声）。可与 style 组合。

示例：style="开心" text="（小声）告诉你一个秘密哦……（语速加快）我中奖啦！"
```

**`execute` 简化**：

```ts
execute: async ({ text, voice, style, direction, stream }) => {
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
        // 下面 uploadToChannel / 结果返回逻辑不变
    }
}
```

关键删除：

- 原 `const effectiveStyle = style ?? config.xiaomiTts?.style;`
- 原 `const finalText = effectiveStyle ? \`<style>${effectiveStyle}</style>${trimmed}\` : trimmed;`

Tool 不再接触 config；voice / style / direction 的 config fallback 完全由 provider 负责。

### 4. Gateway auto-TTS（`packages/core/src/gateway/gateway.ts:105-181`）

删除原 step 6（`<style>${...}</style>${text}` 拼接），step 7 合并为 step 6。

**新版核心代码**：

```ts
// 6. synthesize + upload（style / direction 由 provider 从 config 读取）
try {
    const useStream = config.xiaomiTts?.stream ?? true;
    logger.info(
        `[gateway] auto-tts triggered: channel=${channel.channelType}, provider=${provider.name}, textLen=${text.length}, stream=${useStream}, style=${config.xiaomiTts?.style ?? "(none)"}, direction=${config.xiaomiTts?.direction ? "(set)" : "(none)"}`,
    );
    const result = useStream
        ? await provider.synthesizeStream({ text }, config)
        : await provider.synthesize({ text }, config);
    // uploadToChannel 逻辑不变
```

`direction` 只记标志位不打完整内容（可能是长文本）。gateway 调用 provider 的参数仍然只有 `{ text }`——其它字段由 provider 从 config 读。`TtsProvider` 接口的方法签名（`synthesize` / `synthesizeStream`）不变，但其 `SynthesizeOptions` / `SynthesizeStreamOptions` 类型定义随 section 2 同步更新。

### 5. Web UI（`packages/web/src/components/tools-form.tsx`）

**`DEFAULT_XIAOMI_TTS`**（line 46-51）：新增 `direction: ""`。

**`XIAOMI_TTS_VOICES`**（line 53-57）——整列替换：

```ts
const XIAOMI_TTS_VOICES = [
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

渲染约定：`labelKey ? t(labelKey) : value`。只有 `mimo_default` 需要 i18n。

**`XIAOMI_TTS_STYLE_PRESETS`**（line 59-65）——扩充到覆盖文档全部 8 类：

```ts
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

自由文本输入继续支持。

**新增 `direction` textarea**：在表单中 `style` 之后加一个多行输入。

- 标签 i18n key：`xiaomiTts.direction`
- 占位文 i18n key：`xiaomiTts.directionPlaceholder`（建议内容：`用轻快上扬的语调、语速稍快，带着压抑不住的激动…`）

**i18n 清理**（两个 locale 文件都要改）：

- 删除：`xiaomiTts.voiceDefaultZh`、`xiaomiTts.voiceDefaultEn`
- 新增：`xiaomiTts.direction`、`xiaomiTts.directionPlaceholder`
- `xiaomiTts.voiceMimoDefault` 可选地更新副描述提示集群差异

**`updateXiaomiTts`** 签名已经是 `string | boolean`，`direction: string` 直接适配，无需改动。

## 删除清单（no-compat 一次性清理）

- `packages/tts/src/providers/xiaomi.ts` 里 `model: "mimo-v2-tts"` 两处。
- `packages/core/src/tools/tts.ts` 里 `<style>...</style>${trimmed}` 注入代码。
- `packages/core/src/gateway/gateway.ts` 里 `<style>${config.xiaomiTts.style}</style>${text}` 注入代码及其注释。
- `packages/web/src/components/tools-form.tsx` 里 `default_zh` / `default_en` 音色条目。
- 两个 locale 文件里 `xiaomiTts.voiceDefaultZh` / `xiaomiTts.voiceDefaultEn` key。
- Provider 的 `SynthesizeOptions.user` 字段（无调用方使用），以及 `packages/common/src/types/tts.ts` 中共享的同名字段（`SynthesizeOptions.user` 和 `SynthesizeStreamOptions.user`）。
- Xiaomi provider 内重复定义的本地 `SynthesizeOptions` / `SynthesizeStreamOptions`（改为从 common 引入）。

## 验证

本项目无测试套件（遵循 CLAUDE.md 中"新功能不加测试代码"的约定），靠手动冒烟：

1. **基础合成**（non-stream）：飞书频道下触发任意回复，观察 auto-TTS 是否生成可播放 WAV。
2. **流式合成**：config.xiaomiTts.stream = true，重复同样触发，确认文件正确生成（v2.5 流式虽是兼容模式但 SSE 解析不能坏）。
3. **style 生效**：config.xiaomiTts.style = "开心"，听到音色明显带情绪上扬。
4. **direction 生效**：config.xiaomiTts.direction 设为一段情感描述，听到音色按描述调整。
5. **新音色**：config.xiaomiTts.voice = "冰糖"，听到明显是女声中文。同一步切到 Dean 听到明显是英文男声。
6. **Tool 调用**：agent 主动调用 tts_speak 工具时，带 style / direction 参数确认生效；不带时落回 config 默认。
7. **Web 设置页面**：可以保存新的 direction textarea；音色下拉只有 9 个新音色；风格预设显示完整列表。
8. **typecheck + lint**：`bun run typecheck && bun run check` 必须通过。

## 风险与取舍

- **删除 `default_zh` / `default_en` 的影响**：任何现有 config 如果 voice 配成这两个值，请求会直接失败（v2.5-tts 不认）。用户口径需在 release notes / changelog 里明确"需要手动切换到新音色"。
- **`<style>` → `(xx)` 改动后，已有 prompt 里的 `<style>` 文本会被模型当成字面量读出**。这类遗留配置不多，但要在 release notes 里提一句。
- **流式 v2.5 暂为兼容模式**：代码正确但无延迟收益。文档注释 + log 提醒即可，不降级默认值。
- **风格预设扩到 30+ 个**：下拉变长但不至于不可用；不引入分组 select 是 YAGNI 取舍。

## 落地顺序

为了让每一步都能通过 `bun run typecheck && bun run check`，建议按这个顺序：

1. **Schema**：`xiaomiTtsConfigSchema` 新增 `direction`。
2. **Provider + 共享类型**：同步改 `packages/common/src/types/tts.ts`（`SynthesizeOptions` / `SynthesizeStreamOptions` 去 `user`、加 `style` / `direction`）与 `packages/tts/src/providers/xiaomi.ts`（常量、`buildMessages`、fallback、请求体；删除本地重复类型定义）。
3. **Tool**：改写 `packages/core/src/tools/tts.ts`（input schema、description、execute 简化）。
4. **Gateway**：清理 `packages/core/src/gateway/gateway.ts` 的 style 注入段。
5. **Web UI**：`tools-form.tsx` 音色列表、风格预设、`direction` 表单字段。
6. **i18n**：locale 文件删/加 key。
7. `bun run typecheck && bun run check`，修所有报错。
8. 手动冒烟（见"验证"章节）。
