# DeepSeek Provider Integration

## 目标

把 DeepSeek 作为一等公民 provider 接入 OpenMantis，使用官方 `@ai-sdk/deepseek` 包。用户可在 web 设置向导里选择 "DeepSeek" 作为 provider 类型，默认 base URL 自动填好，模型 id 由用户手填（`deepseek-v4-flash` / `deepseek-v4-pro`，或仍兼容旧 id `deepseek-chat` / `deepseek-reasoner`）。

## 背景

- DeepSeek 在 2026-04-24 发布 V4，当前模型 id 为 `deepseek-v4-flash`（非思考）和 `deepseek-v4-pro`（思考）。
- 旧 id `deepseek-chat` / `deepseek-reasoner` 将于 2026-07-24 下线，期间自动映射到 v4-flash 的 non-thinking / thinking 模式。
- `@ai-sdk/deepseek`（v2.0.29）已支持新旧 id，模型 id 以字符串透传。
- DeepSeek API 是 OpenAI 兼容协议，理论上现有 `openai-compatible` provider 可以接，但走专用 provider 的好处是 SDK 原生把 `reasoning_content` 解析为 reasoning parts，gateway 不需要再加 middleware。

## 范围

**做：**

- 新增 `deepseek` provider 类型，调用 `@ai-sdk/deepseek` 的 `createDeepSeek`。
- web 设置向导里把 DeepSeek 加入 provider 类型下拉，base URL 自动填 `https://api.deepseek.com/v1`。

**不做：**

- 不硬编码模型 id 列表（与现有所有 provider 保持一致，由用户手填）。
- 不解析 / 暴露 DeepSeek 的 prompt cache 命中 metadata。
- 不为 DeepSeek 自定义 fetch 拦截器或 middleware。
- 不动 i18n 文件（provider 标签是硬编码的）。
- 不改 schema（`provider: z.string()` 已对新值开放）。

## 设计

### `reasoningEffort` 处理

DeepSeek 推理是否开启完全由模型 id 决定（`deepseek-v4-pro` / `deepseek-reasoner` 强制推理，`deepseek-v4-flash` / `deepseek-chat` 不推理），不像 OpenAI/Anthropic 支持档位调节。因此 `resolveThinkingOptions` 不为 deepseek 加分支，落入 default 空返回，`reasoningEffort` 字段在 deepseek provider 下不起作用。

### Provider 实例化

`packages/core/src/agent/providers.ts` 新增分支：

```ts
case "deepseek": {
    const deepseek = createDeepSeek({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseUrl || undefined,
    });
    return deepseek(model);
}
```

行为：

- baseURL 留空 → SDK 默认 `https://api.deepseek.com/v1`；填了 → override。与 `openai` / `anthropic` 分支完全一致。
- 模型 id 字符串透传给 SDK。
- 不注入 fetch 拦截器、不附加自定义 header。
- reasoning 由 SDK 原生解析为 reasoning parts，gateway 现有流式路径无需改动。

### 错误处理

SDK 抛错由现有 gateway try/catch 捕获，不在 provider 分支额外包裹，与 openai/anthropic 一致。

### UI 改动

`packages/web/src/components/provider-form.tsx`：

- `PROVIDER_TYPES` 数组追加 `{ value: "deepseek", label: "DeepSeek" }`。
- `PROVIDER_BASE_URLS` 对象追加 `deepseek: "https://api.deepseek.com/v1"`。

用户操作流：选 DeepSeek → baseUrl 自动填好（可清空走 SDK 默认，可改走代理）→ 填 API key → 添加 model（推荐 `deepseek-v4-flash` 或 `deepseek-v4-pro`）→ 保存。

## 改动文件清单

1. `packages/core/package.json` — 加依赖 `@ai-sdk/deepseek`（v2.0.29）。
2. `packages/core/src/agent/providers.ts` — 新增 `case "deepseek"` 分支。
3. `packages/web/src/components/provider-form.tsx` — `PROVIDER_TYPES` 与 `PROVIDER_BASE_URLS` 各加一项。

`thinking.ts` 不需要改（无 deepseek case 即可）。`schema.ts` 不需要改（`provider: z.string()` 已开放）。

## 验证

**自动化（必须通过）：**

- `bun run typecheck`
- `bun run check`

**手动烟雾测试（由用户执行，不写自动化）：**

1. `bun run dev:full` 启动 dev。
2. web UI 添加 DeepSeek provider，填真实 API key 和 `deepseek-v4-flash`。
3. 接入的 channel（如 feishu）发一条消息，确认正常回复。
4. 切到 `deepseek-v4-pro`，发一条需要推理的消息，确认 reasoning 内容能流式输出到 channel（log 里能看到 reasoning parts）。

不写单元测试——`providers.ts` 是纯 SDK wrapper，与现有 provider 测试覆盖风格一致。

## 回滚

三处改动彼此独立：单文件 revert 即可移除该 provider。用户残留配置里 `provider: "deepseek"` 在 revert 后会落入 default 分支报 `Unsupported provider`，符合预期行为。
