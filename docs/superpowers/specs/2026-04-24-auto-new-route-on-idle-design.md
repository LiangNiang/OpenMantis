# 空闲自动新建对话设计（V1）

**日期**：2026-04-24
**状态**：Design approved, pending plan

## 背景与目标

OpenMantis 里每个 chat（飞书/WeCom/QQ 的私聊或群聊）都绑定到一个 route，消息历史会持续累积到同一 route，直到用户主动执行 `/new`。

实际使用中有两个痛点：

1. **用户忘记 `/new`** —— 上下文越堆越大，浪费 token，模型也更容易被无关旧对话干扰。
2. **用户"保险起见"频繁 `/new`** —— 丢失了本可复用的近期上下文。

目标：在 chat 空闲一段时间后，于下一条新消息到达时自动切到新 route；同时对旧 route 异步做一次 recap 归档，用户之后 `/list` + `/resume` 仍能回到旧对话。

V1 刻意保持最小面积：

- 单一触发维度：**空闲时长**（`now - route.updatedAt > idleMinutes`）。不做 token/消息数/绝对年龄等叠加维度。
- 全局一份配置，不做渠道级覆盖。
- 群聊与私聊一视同仁。
- 提示语 in-band 注入到用户这条消息的回复流里，不走单独的 push。

## 非目标（V1 不做）

- 按 token / 消息数 / 绝对年龄触发
- 按渠道（feishu/wecom/qq）或按 chatId 覆盖阈值
- 群聊特殊策略
- 把旧 route 的 recap 自动注入到新 route 作为上下文 seed
- 后台定时任务（只做惰性检查）
- 展示 recap 的 UI 入口（沿用现有 `/recap` 的持久化路径，之后若接 UI 两者共享）
- 用户可配置提示文案

## 术语

- **stale route**：满足 `enabled && messages.length > 0 && now - updatedAt > idleMinutes * 60_000 && !inflight` 的 route。
- **auto-new 触发**：在 `Gateway.handleMessage` 入口识别到 stale route 后，创建新 route、重写 channel binding、异步归档旧 route 的全过程。

## 触发点与检查时机

**位置**：`packages/core/src/gateway/gateway.ts` 的 `Gateway.handleMessage`，在 `routeStore.getOrCreate(...)` 之后、`route.messages.push({ role: "user", ... })` 之前。

**为什么在 Gateway 而不在 channel 层**：

- Gateway 同时握有 `routeStore`（读 `updatedAt`）和 `channelBindings`（重写绑定），逻辑只写一遍，三个 channel 全部受益。
- Channel 现有的 `getRouteId(chatId)` 保持薄查找，不增加职责。
- `incoming.routeId` 已由 channel 解析，但在 Gateway 里重绑不影响后续处理。

**触发条件**（全部满足）：

1. `config.autoNewRoute.enabled === true`
2. `route.messages.length > 0`
3. `Date.now() - route.updatedAt > config.autoNewRoute.idleMinutes * 60_000`
4. `!this.inflight.has(route.id)`

**为什么用 `route.updatedAt`**：`ModelMessage` 无时间戳；`updatedAt` 在每次 `routeStore.save` 时刷新，天然是"最后活动时间"。`/clear` 清消息后也会刷新 `updatedAt`——清完的 route 不会被当作 stale。符合语义。

**惰性检查**：仅在 `handleMessage` 入口做一次比较，不引入定时器。

## 切换流程

stale 判定为真时，在 push user message 之前按顺序执行：

1. 保留旧引用：`const oldRoute = route`
2. 生成新 id：`const newId = this.routeStore.generateId()`
3. 创建新 route：`route = await this.routeStore.create(newId, incoming.channelType, incoming.channelId)`
4. 重写绑定：`await this.channelBindings.set(incoming.channelType, incoming.channelId, newId)`
5. 异步归档：`void archiveRouteWithRecap({ route: oldRoute, config, routeStore })`
6. 标记 `autoNewTriggered = true`（后续 stream 需要注入前缀）
7. 走现有流程：`route.messages.push(user)`, agent 推理, 保存

**为何切换必须先于 push user message**：否则用户这条新消息会先落进旧 route 并刷新 `updatedAt`，再被切走，数据错位。

**失败语义**：

- 步骤 3 抛错 → 整条 `handleMessage` 抛错，走现有 `rejected` 分支，用户看到错误可以重发。
- 步骤 4 抛错 → 容忍：route 已建好可以继续推理；最坏情况是下次消息仍命中旧 route，但届时旧 route 仍 stale，会再次触发（等价于多尝试一次）。
- 步骤 5 永不抛（内部 try/catch + 日志）。

**复用性**：现有 slash `/new` 命令通过 channel 闭包里的 `switchRoute` 回写 binding；Gateway 直接调 `channelBindings.set(type, chatId, newId)` 即可，Gateway 已持有 `channelBindings`（`gateway.ts:179`）。

**幂等性**：同一条 incoming 只在入口检查一次，无重试循环。

## Recap 异步归档

**目标**：旧 route 被替换后仍保留可读性；日后 `/list` + `/resume` 看到有意义的摘要。

**执行模型**：fire-and-forget，不阻塞用户当前消息的回复。

**实现**：抽一个共享函数，`/recap` 命令和 auto-new 都走它。建议落在 `packages/core/src/recap/summarizer.ts`（或新增 `archive.ts`）：

```ts
export async function archiveRouteWithRecap(params: {
  route: Route;
  config: OpenMantisConfig;
  routeStore: RouteStore;
}): Promise<void> {
  const { route, config, routeStore } = params;
  try {
    const output = await generateRecap({ route, config });
    const entry: RecapEntry = {
      id: crypto.randomUUID().slice(0, 8),
      createdAt: Date.now(),
      messageCount: route.messages.length,
      provider: output.provider,
      modelId: output.modelId,
      result: output.result,
    };
    route.recaps = [...(route.recaps ?? []), entry];
    await routeStore.save(route);
    logger.info(`[auto-new] recap archived for route=${route.id}`);
  } catch (err) {
    logger.warn(`[auto-new] recap failed for route=${route.id}, skipping:`, err);
  }
}
```

`packages/core/src/commands/recap.ts` 改为调用同一函数，收敛逻辑。

**跳过 recap 的条件**：

- `config.autoNewRoute.recap === false`
- 旧 route `messages.length < 3`（太短无意义，硬编码阈值，不暴露配置）

**并发与写冲突**：步骤 4 完成后，旧 route 已与任何 channel binding 解耦，不再有新消息进来；RouteStore 的 in-memory cache 在归档读改写区间内无别的写者。`/resume <旧id>` 是只读。安全。

**无限递归防护**：`generateRecap` 走独立 `generateText` 调用，不经过 `Gateway.handleMessage`，不会再次触发 auto-new。

## 用户可见提示

**方案**：在 Gateway 的 `wrappedStream` 生成器开头，作为第一个 `text-delta` yield 一段系统前缀，然后再串联 agent 的正常 `fullStream`。

```ts
if (autoNewTriggered) {
  yield { type: "text-delta", text: prefix };
}
for await (const ev of toStreamEvents(streamResult.fullStream)) {
  yield ev;
  if (signal.aborted) break;
}
```

**文案参数化**（在 gateway 里格式化）：

```ts
const minutes = config.autoNewRoute.idleMinutes;
const desc = minutes >= 60 && minutes % 60 === 0
  ? `${minutes / 60} 小时`
  : `${minutes} 分钟`;
const prefix = `🆕 空闲超过 ${desc}，已开启新对话（旧会话已归档，/list 可查看）\n\n`;
```

**为什么不用 `channel.pushMessage`**：

- 另起一条要跨 channel 异步，时序可能晚于 agent 回复，出现"先看到回答再看到提示"的错位。
- 各 channel 的 `pushMessage` 实现成熟度不一。
- 现有的 busy 拒绝提示（`gateway.ts:286`）也是 in-band 的，保持一致。

**不写入 `route.messages`**：前缀仅作为用户可见流式输出；**不**持久化到新 route 的消息列表，否则会污染后续 LLM 上下文，也会让 `/history` 出现非真实对话内容。

**fallback generate 路径**（`gateway.ts:491-532`，流式失败时走的非流式分支）：该路径没有 `fullStream`，直接把 `prefix` 拼到 `outgoing.content` 开头即可。

## 配置 schema

**位置**：`packages/common/src/config/schema.ts`。

**新增**：

```ts
const autoNewRouteSchema = z.object({
  enabled: z.boolean().default(true),
  idleMinutes: z.number().int().positive().default(120),
  recap: z.boolean().default(true),
});

export type AutoNewRouteConfig = z.infer<typeof autoNewRouteSchema>;
```

**挂载**：`configSchema` 顶层加字段：

```ts
autoNewRoute: autoNewRouteSchema.default({
  enabled: true,
  idleMinutes: 120,
  recap: true,
}),
```

**为什么用 `.default(...)` 而不是 `.optional()`**：zod 解析后字段必存在，Gateway 里读取无需空保护，代码更干净。存量 config 文件没写这个字段也被自动补上，无破坏性。

**敏感字段**：都是布尔/数字，不涉及 `sensitive.ts` 的脱敏逻辑。

**合并**：`merge.ts` 的 deep-merge 对布尔/数字字段天然工作——实现阶段需要跑一遍确认。

**Web 设置页**：`packages/web` 的设置页新增"对话管理"卡片（或并入"全局"卡），三个字段：

- 开关（Switch）——`enabled`
- 空闲阈值（数字，单位分钟）——`idleMinutes`
- 切换时生成 recap（Switch）——`recap`

UI 样式抄现有 shadcn 风格，具体控件布局留给实现。

## 模块布局

**新增**：

- （可选）`packages/core/src/recap/archive.ts` —— 导出 `archiveRouteWithRecap`。也可以直接放在 `summarizer.ts` 里，避免新文件。实现阶段选一个。

**改动**：

- `packages/common/src/config/schema.ts` —— 加 `autoNewRouteSchema` 与 `configSchema.autoNewRoute`。
- `packages/core/src/gateway/gateway.ts` —— `handleMessage` 入口加 stale 检查与切换流程；`wrappedStream` 注入前缀；fallback 路径拼前缀。
- `packages/core/src/commands/recap.ts` —— 重构为调用 `archiveRouteWithRecap`（消除重复逻辑）。
- `packages/core/src/recap/summarizer.ts` 或新文件 —— 提供 `archiveRouteWithRecap`。
- `packages/web/src/...` —— 设置页加 "自动新建对话" 区块。

**不动**：

- `Route` / `RouteStore` / `ChannelBindings` 接口。
- `CommandRouter` / `CommandContext`。
- Channel 适配层（`channel-feishu`、`channel-wecom`、`channel-qq`）——`getRouteId` 仍是纯薄查找，切换由 Gateway 在 channel binding 上完成。
- `AgentFactory`、系统提示词、工具层。

## 数据流

正常消息（未触发 auto-new）：

```
user message
  → channel.getRouteId(chatId) → bindings 查到 routeId
  → Gateway.handleMessage
  → routeStore.getOrCreate(routeId)
  → [stale 检查 = false]
  → route.messages.push(user)
  → agent stream → response → save
```

触发 auto-new：

```
user message (空闲 >= idleMinutes 后到达)
  → channel.getRouteId(chatId) → bindings 查到 oldId
  → Gateway.handleMessage
  → routeStore.getOrCreate(oldId)   // load oldRoute
  → [stale 检查 = true]
  → newId = routeStore.generateId()
  → routeStore.create(newId, ...)   // newRoute
  → channelBindings.set(..., newId) // rebind
  → void archiveRouteWithRecap(oldRoute)   // fire-and-forget
  → autoNewTriggered = true
  → newRoute.messages.push(user)
  → agent stream
  → wrappedStream yield {text-delta: prefix}  // 一次性前缀
  → wrappedStream 继续 yield agent 流
  → response → save
```

## 边界情况

| 场景 | 行为 |
|---|---|
| 首次对话（binding 不存在） | 正常走现有新建流程，auto-new 不参与。 |
| route 存在但 `messages.length === 0` | 跳过 stale（没必要换空 route）。 |
| 用户刚 `/clear` | `updatedAt` 被 clear 刷新，不 stale，不触发。 |
| 用户刚 `/new` | 新 route `updatedAt == createdAt`，不 stale，不触发。 |
| 旧 route 有 inflight | 保守跳过 auto-new；现有 inflight 拒绝逻辑照常生效。 |
| Recap LLM 失败 | 警告日志，不影响用户当前消息；旧 route `recaps[]` 不变。 |
| 旧 route 消息 `< 3` | 跳过 recap，但仍切换。 |
| `enabled: false` | 完全跳过检查，0 额外开销。 |
| 群聊 | 与私聊一致——binding key 是 chatId，`updatedAt` 衡量的是该 chat 的最近活跃。群聊停聊达到阈值后下一条消息触发整群切换。 |

## 手动验证

项目无自动化测试（见 CLAUDE.md），按以下路径冒烟：

1. 打开 web 设置，`idleMinutes` 调成 1，`enabled: true`，`recap: true`，重启。
2. 在任一渠道发一条消息，等模型回复。
3. `/list` 记下当前 route id。
4. 等 70 秒，再发一条消息。
5. 预期：
   - 回复开头出现 "🆕 空闲超过 1 分钟，已开启新对话…" 前缀。
   - `/list` 多一条新 route，旧 id 仍在。
   - `/resume <旧id>` + `/history` 看得到旧消息。
   - `$OPENMANTIS_DATA_DIR/routes/<旧id>.json` 的 `recaps[]` 多一条。
6. 边界：
   - `recap: false` → 重复流程，`recaps[]` 不变。
   - `enabled: false` → 不切换，没有前缀。
   - `/clear` 后等过阈值再发 → 不切换（`updatedAt` 已被刷新）。
   - fallback 路径：人为让 stream 失败（或代码里临时抛错）确认前缀仍拼进 `outgoing.content`。

## 开放问题

无。V1 所有设计点已确认。

## 后续可能的扩展（本次不做，但不与本设计冲突）

- 渠道级阈值覆盖（`feishu/wecom/qq` schema 里加 `autoNewRoute?`）
- 群聊单独策略
- 把旧 recap 自动注入新 route 作为 seed
- 按 token / 消息数触发
- Web 控制台里展示 recap 历史
