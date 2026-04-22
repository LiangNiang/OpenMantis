# `/recap` 命令设计（V1）

**日期**：2026-04-22
**状态**：Design approved, pending plan

## 背景与目标

参照 Claude Code 的 `/recap`，给 OpenMantis 加一个 slash 命令：用户在任一 channel 里发 `/recap`，由 LLM 把当前 route 的消息历史总结为一份结构化回顾。

V1 刻意保持最小面积：

- 无参数，只回顾当前 route 的全量 `messages`
- 输出"一句话抬头 + 四段固定结构"
- 调用与 route 当前一致的 provider/model
- 独立 LLM 调用，不经过 agent、不触发工具
- 结果持久化到 `route.recaps[]`，但 V1 不接任何展示入口（为后续铺垫）
- 空 route / inflight 均放行，不做特殊处理

## 非目标（V1 不做）

- 参数化范围（`/recap N`、`/recap 1h`、跨 route 等）
- 自动触发（按消息数或时间）
- Web 控制台、`/list`、`/history` 等地方展示 recap 历史
- 独立的 `recap.provider` 配置
- 结构化 UI 渲染（飞书卡片等）——V1 统一走 `display` 纯文本
- Token/成本统计
- 并发锁

## 模块布局

**新增：**

- `packages/core/src/recap/types.ts` — 导出 `RecapEntry`、`RecapSection`、`RecapResult`。
- `packages/core/src/recap/summarizer.ts` — 导出 `generateRecap({ route, config })`，负责 provider/model 解析、prompt 构造、`generateText` 调用、结构化输出与自由文本 fallback 解析。结构对标 `packages/core/src/tools/memory/extractor.ts`。
- `packages/core/src/commands/recap.ts` — 导出 `recapCommand: CommandDefinition`。仅命令入口，不含 LLM 逻辑。

**改动：**

- `packages/core/src/gateway/route.ts` — `Route` 加可选字段 `recaps?: RecapEntry[]`。
- `packages/core/src/gateway/route-store.ts` — `get()` 反序列化时 `recaps: data.recaps ?? []`，`save()` 序列化时带上 `recaps`。
- `src/index.ts` — `router.register(recapCommand)`。

**不动：**

- `CommandRouter` / `CommandContext` / `CommandResult` 类型。
- Channel 适配层（`display` 类型所有 channel 已支持）。
- 配置 Schema（`packages/common/src/config/schema.ts`）。
- 系统提示词 / AgentFactory。

## 数据模型

```ts
// packages/core/src/recap/types.ts
export interface RecapSection {
  goal: string;       // 目标
  decisions: string;  // 关键决策
  changes: string;    // 主要改动（来自工具调用记录）
  todos: string;      // 待办或未决
}

export interface RecapResult {
  heading: string;   // 一句话抬头（<= 30 字）
  sections: RecapSection;
}

export interface RecapEntry {
  id: string;            // crypto.randomUUID().slice(0, 8)
  createdAt: number;     // Date.now()
  messageCount: number;  // 摘要覆盖的 route.messages.length 快照
  provider: string;      // 使用的 provider name
  modelId: string;       // 使用的 model id
  result: RecapResult;
}
```

Route schema：

```ts
// packages/core/src/gateway/route.ts
export interface Route {
  // ...现有字段...
  recaps?: RecapEntry[];
}
```

**为何四段内容都是 `string` 而非 `string[]`：** 让模型自由决定 bullet 还是段落，渲染端直接拼。后续要结构化渲染再加字段。

**为何同时存 `provider` 与 `modelId`：** 同 `modelId` 在不同 provider 下含义不同（例如两个 OpenAI-compatible provider 都声明 `gpt-4o-mini`），两者合一才能完整回溯。

**兼容性：** 老 route JSON 没有 `recaps` 字段，`get()` 兜底为 `[]`，首次 `/recap` 后字段自动出现。不需要迁移脚本。

## Summarizer

`generateRecap({ route, config })` 流程：

1. `providerName = route.provider ?? config.defaultProvider`
2. `providerConfig = resolveProvider(config, providerName)`
3. `modelConfig = providerConfig.models[0]!`
4. `model = await createLanguageModel(providerConfig, modelConfig)`
5. `conversation = formatConversation(route.messages)`
   - 逐条 `[role] content` 拼接。`content` 为对象/数组时 `JSON.stringify` 后再截断。单条上限 300 字符（与 memory extractor 对齐）。
   - 工具消息不特殊剔除——正是 `sections.changes` 的信息源。
6. `generateText({ model, output: Output.object({ schema }), prompt, temperature: 0.3 })`
   - `schema` 为 `RecapResult` 的 Zod 版本。
7. 结构化输出失败 → fallback 到自由文本 `generateText`，提取首个 `{...}` 后 `JSON.parse`，Zod 校验通过才接受。
8. 返回 `{ result, provider: providerName, modelId: modelConfig.id }`。

**Prompt 草案：**

```
你是一个会话回顾助手。阅读下面这段人类用户与 AI Agent 的对话，生成一份结构化回顾。

对话记录：
{CONVERSATION}

输出 JSON，字段含义：
- heading: 一句话概括整段对话在做什么（<= 30 字）
- sections.goal: 用户这次想达成的目标
- sections.decisions: 对话中做出的关键决策（技术选型、方案取舍等）
- sections.changes: 实际产生的改动（文件、命令、外部调用等，来自工具调用记录）
- sections.todos: 尚未完成的事项或未决问题

规则：
1. 用与对话相同的语言写。
2. 每个 section 内容用 markdown bullet 或短段落，不要再嵌套 JSON。
3. 没有内容的 section 写"(无)"而不是省略字段。
4. 不要编造对话里没有的信息。
```

**`temperature: 0.3`：** memory extractor 用 `0` 追求确定性；recap 要自然语言可读，略抬一点，但不到聊天默认的 `0.7`。

**不用 streamText：** recap 是一次性整体产物，且 `display` 类型的 CommandResult 本就返回字符串，流式无收益。

## 命令流程

`recapCommand.execute(ctx)`：

1. `route = await ctx.routeStore.get(ctx.currentRouteId)`
   - 找不到 → `{ type: "display", text: "会话未找到" }`
2. `entry = await generateRecap({ route, config: ctx.config })`
   - 抛错 → `{ type: "display", text: "生成 recap 失败：<message>" }`，log warn
3. `route.recaps = [...(route.recaps ?? []), entry]`
4. `await ctx.routeStore.save(route)`
   - 失败只 log warn，继续返回 display（摘要已生成，保存是次要优化）
5. 返回 `{ type: "display", text: renderRecap(entry.result) }`

**`renderRecap(result)` 输出：**

```
📋 {heading}

**目标**
{sections.goal}

**关键决策**
{sections.decisions}

**主要改动**
{sections.changes}

**待办 / 未决**
{sections.todos}
```

- `**` 加粗在飞书/WeCom/QQ 纯文本回复里渲染或至少不难看；`#` 标题在部分 channel 显示为裸 `#`。
- `📋` emoji 做视觉锚点，对齐现有 `⏹` / `⚠️` 风格。

## 错误与边界

| 场景 | 行为 |
|---|---|
| LLM 网络/鉴权/配额失败 | display 错误信息，不写 `recaps`，不抛 |
| Provider 配置缺失 | 同上 |
| 结构化输出 + fallback 都失败 | 同上 |
| 保存 route 失败 | log warn，仍返回 display |
| 空 route（0 或 1 条消息） | 放行，模型可能输出 `(无)` |
| Route inflight 中 | 放行，摘到当时已落盘的 `messages`，缺掉正在生成的 assistant 回复 |
| 并发 `/recap` | V1 不加锁，`route-store.save` 最后写入者胜，可能丢一条 `recaps` 条目。单用户单 channel 极罕见，YAGNI |

## 注册点

`src/index.ts` 的 `router.register(...)` 列表末尾加：

```ts
router.register(recapCommand);
```

## 日志

新增 logger scope：`core/recap`（通过 `createLogger("core/recap")`）。覆盖：

- `info`：开始生成（routeId、provider、modelId、messageCount）
- `info`：成功（elapsed ms）
- `warn`：失败（原因）

## 测试策略

项目约定：不加 test 代码，用户手动冒烟。

**自动检查：**

- `bun run typecheck`
- `bun run check`

**手动冒烟清单：**

1. 正常流程：任一 channel 发 `/recap`，收到 📋 抬头 + 四段；`.openmantis/routes/{id}.json` 末尾多 `recaps` 数组含一条完整条目。
2. 老 route 兼容：对历史（无 `recaps` 字段）route 跑 `/recap`，首次 OK。
3. 连续两次：同 route `/recap` 两次，`recaps[]` 长度为 2。
4. 空 route：`/new` 后立刻 `/recap`，不报错、不崩。
5. Inflight：长对话流式过程中另发 `/recap`，放行，只摘已落盘内容。
6. 错误路径：临时把 provider `baseURL` 改为不可达地址，`/recap` 收到错误 display，`recaps[]` 无新增。

**日志验证：** `.openmantis/openmantis.log` 内 `[core/recap]` scope 可见开始/成功/失败三类日志。

## Roadmap（V1 之后，非本次范围）

- 参数化（`/recap last N`、`/recap since 1h`、跨 route）
- 自动触发（按消息数阈值或时间阈值）
- Web 控制台展示 `route.recaps[]`
- `/list` 里显示 recap 计数
- 独立 `recap.provider` 配置，允许用便宜小模型
- 结构化 UI（飞书卡片等）
