# Auto-Recap 完成通知设计（V1）

**日期**：2026-04-28
**状态**：Design approved, pending plan

## 背景与目标

`autoNewRoute` 触发后，Gateway 会异步（fire-and-forget）调用 `archiveRouteWithRecap` 给旧 route 生成结构化摘要。当前实现里，recap 成功只写一行 `info` 日志，用户在 chat 里完全无感。

实测一次完整流程（见 `.openmantis/openmantis.log`）：

- `02:35:50` auto-new triggered，旧 route 84 msgs，新建空 route
- `02:35:50` `[recap] generate` 开始
- `02:36:56` `[recap] success`，耗时 65s
- 期间用户已经收到了新对话的第一次回复

**目标**：recap **生成成功**后，往原 chat 推一条灰字单行通知，让用户知道：

1. 上一段对话被归档了（避免"我之前聊的内容是不是丢了"的疑虑）
2. 那段对话的一句话主题（`heading`，由 LLM 生成 ≤30 字）
3. 进一步查看的入口（`/list`）

V1 刻意保持最小面积：

- 只覆盖 `autoNewRoute` 这条路径；`/recap` 命令本身已 inline 返回摘要，不再推送
- 单行灰字，不塞四段结构化内容
- 失败静默，不打扰
- 不在新 route 持久化此通知；它只是渠道侧的一次性 push
- 不动 `pushMessage` 签名

## 非目标（V1 不做）

- 失败也推送
- 推送完整四段 recap（goal/decisions/changes/todos）
- 推送到 Web 控制台
- 飞书可折叠面板（`collapsible_panel`）渲染
- `/resume` 一键按钮（飞书 interactive button）
- 用户可配置文案
- 多语言 i18n（与现有 auto-new 前缀的硬编码中文保持一致）
- QQ 走引用块 `>` 退化（用户决定 QQ 用普通颜色即可）

## 各渠道渲染能力

| 渠道 | 灰色文字方案 | 备注 |
|---|---|---|
| 飞书 | `<font color='grey'>…</font>` | `pushMessage` 包成 interactive card with `tag: "markdown"`，命名颜色与 hex 都支持 |
| WeCom | `<font color="comment">…</font>` | markdown 消息只支持 3 个命名色：`info`/`comment`/`warning`，`comment` = 灰 |
| QQ | 不支持 | QQ Bot 普通 markdown 不渲染 `<font>`；本设计接受退化为普通颜色文字 |

## 模块布局

**新增**：

- `packages/core/src/recap/notice.ts` — 导出纯函数 `formatRecapNotice(channelType, heading): string`。

**改动**：

- `packages/core/src/gateway/gateway.ts` — 把现有 `archiveRouteWithRecap(...).then(entry => logger.info(...))` 扩展为 log 之后再调 `pushMessage`，含独立 try/catch。

**不动**：

- `packages/core/src/recap/summarizer.ts`：`archiveRouteWithRecap` 保持纯归档原语，不增加"通知"职责（`/recap` 命令也复用它）
- `packages/core/src/commands/recap.ts`
- 三个 channel adapter（`packages/channel-feishu`、`channel-wecom`、`channel-qq`）：`pushMessage` 签名 `(channelId, content)` 不变
- `Route` / `RouteStore` / 配置 schema
- `tools/message.ts`（agent 工具调用 `gateway.pushMessage` 的链路）

## `formatRecapNotice` 设计

纯函数，输入 `channelType: string` 与 `heading: string`，返回最终发到 channel 的字符串。

```ts
// packages/core/src/recap/notice.ts
export function formatRecapNotice(channelType: string, heading: string): string {
  const body = `📋 上次对话已归档：${heading}（/list 可查看）`;
  if (channelType.startsWith("feishu")) return `<font color='grey'>${body}</font>`;
  if (channelType.startsWith("wecom"))  return `<font color="comment">${body}</font>`;
  return body;
}
```

**为什么用 `startsWith`**：飞书是 `feishu:main` / `feishu:secondary` 多实例形态（gateway.ts 内部既有此约定）；WeCom / QQ 当前是单实例的 `wecom` / `qq`，但 `startsWith` 与未来扩展兼容。未知 channelType 走默认 `body`（无颜色），不会崩。

**HTML 注入风险**：`heading` 由 `/recap` 的 prompt 约束 "<= 30 字概括"，自然语言场景，含 `<` 概率极低。即便出现：

- 飞书卡片：`buildReplyCard` 包在 markdown element 里，未闭合 tag 不会破坏整张卡片解析
- WeCom：raw markdown 不会"渲染"成 HTML 元素，只会显示原文
- QQ：普通文本

**判定**：不加 escape，YAGNI。如实测中发现 LLM 偶发输出 `<` `>` 导致渲染怪异，再加 `heading.replace(/[<>]/g, "")` 即可。

**符号选择**：

- 起头 emoji `📋` 与 `/recap` 命令的渲染头一致（`packages/core/src/commands/recap.ts` 的 `renderRecap`），形成视觉关联
- 不带换行：单行才是"通知"语义，多行就抢戏了
- `/list` 不写 `/list 可查看完整摘要`——更短的"可查看"已经足够暗示

## Gateway 改动

`gateway.ts:329-342` 当前：

```ts
if (autoNewCfg.recap && oldRoute.messages.length >= 3) {
  archiveRouteWithRecap({
    route: oldRoute,
    config: this.config,
    routeStore: this.routeStore,
  })
    .then((entry) =>
      logger.info(
        `[gateway] auto-new: recap archived old=${oldRoute.id}, recapId=${entry.id}`,
      ),
    )
    .catch((err) =>
      logger.warn(`[gateway] auto-new: recap failed for old=${oldRoute.id}:`, err),
    );
}
```

改为：

```ts
if (autoNewCfg.recap && oldRoute.messages.length >= 3) {
  archiveRouteWithRecap({
    route: oldRoute,
    config: this.config,
    routeStore: this.routeStore,
  })
    .then(async (entry) => {
      logger.info(
        `[gateway] auto-new: recap archived old=${oldRoute.id}, recapId=${entry.id}`,
      );
      const text = formatRecapNotice(incoming.channelType, entry.result.heading);
      try {
        await this.pushMessage(incoming.channelType, incoming.channelId, text);
      } catch (err) {
        logger.warn(
          `[gateway] auto-new: recap notify failed for old=${oldRoute.id}:`,
          err,
        );
      }
    })
    .catch((err) =>
      logger.warn(`[gateway] auto-new: recap failed for old=${oldRoute.id}:`, err),
    );
}
```

**闭包捕获**：`incoming.channelType` 与 `incoming.channelId` 在 `handleMessage` 整个调用周期都活着（已经被 channel binding 重写、auto-new prefix 等多处引用）。`oldRoute` 同样靠闭包穿越异步边界，pattern 已被现有代码验证。

**为什么 push 失败用独立 try/catch 而不让外层 `.catch` 接住**：

- 外层 `.catch` 语义是"recap 生成失败"
- push 失败是**不同事件**——recap 已经成功保存到旧 route 了，只是通知没送达
- 分开记录便于后续排查："recap failed" 看 LLM；"notify failed" 看 channel/网络
- 不让 push 失败把 entry 信息吞掉

**幂等与重试**：push 失败不重试。理由：
- recap 已保存到 `route.recaps[]`，没丢
- 用户随时可 `/list` + `/resume` + `/recap` 主动看
- 自动重试可能带来更糟体验（用户隔几分钟收到一条迟到通知）

## 数据流

```
[handleMessage 入口]
  └─ stale 判定 = true
       ├─ create newRoute, rebind channel binding
       ├─ archiveRouteWithRecap(oldRoute) [fire-and-forget]
       │    │
       │    │  (~30-90s 后)
       │    ▼
       │    .then(async entry => {
       │       logger.info("recap archived ...")
       │       text = formatRecapNotice(channelType, entry.result.heading)
       │       this.pushMessage(channelType, channelId, text)
       │         ├─ feishu  → card with <font color='grey'>...</font>
       │         ├─ wecom   → markdown <font color="comment">...</font>
       │         └─ qq      → plain "📋 上次对话已归档：…"
       │    })
       │
       └─ 主流程继续：push user message → agent stream → response
            （可能在 recap 完成前就已经回复完毕）
```

## 边界情况

| 场景 | 行为 |
|---|---|
| recap 生成失败 | 走外层 `.catch`，log warn，**不推通知**——已是现状 |
| `pushMessage` 网络抖动 / channel 后端故障 | 独立 try/catch，log warn，不重试，不影响其他流程 |
| 该 channel 未实现 `pushMessage` | `Gateway.pushMessage` 抛 `渠道 X 不支持 pushMessage`（gateway.ts:231），落入 try/catch，warn 后吞掉。当前三个 channel 都已实现 |
| 用户在新 route 里正在流式生成回复时 recap 完成 | push 是独立 channel API 调用，会作为新一条消息送达；channel 端无并发约束。最坏体验是"用户的 follow-up 回复正在打字 → 中间收到一条灰字通知"——可接受 |
| `heading` 为空字符串 | 渲染为 `📋 上次对话已归档：（/list 可查看）`，难看但不致命。LLM prompt 已约束必出 heading，实际罕见。**不加防御** |
| `heading` 含 `<`/`>` | 见上文 "HTML 注入风险" 段，不做 escape |
| `/recap` 命令触发的 archive | `recapCommand.execute` 不经过 gateway 的 `.then`（直接 await `archiveRouteWithRecap` → 渲染 display 返回）。这条路径**不**触发推送。隔离干净 |
| 旧 route `messages.length < 3` | 现有逻辑跳过 recap 生成，自然也不推送 |
| `autoNewRoute.recap === false` | 现有逻辑跳过 recap 生成，自然也不推送 |
| `autoNewRoute.enabled === false` | auto-new 整段不进入，无通知 |

## 手动验证

CLAUDE.md 约定无自动测试。冒烟清单：

1. 设置面板把 `idleMinutes` 改成 1，`enabled: true`，`recap: true`，重启 daemon
2. 飞书私聊发一条消息，等回复完
3. 等 70 秒，再发一条**触发 auto-new**
4. 预期：
   - 新对话第一回复正常返回（含 "🆕 空闲超过 1 分钟…" 前缀）
   - 30–90 秒后，chat 里多出一条**灰色**消息：`📋 上次对话已归档：<heading>（/list 可查看）`
   - `.openmantis/openmantis.log` 内可见：
     - `[gateway] auto-new: recap archived old=…, recapId=…`
     - 之后没有 `recap notify failed` warn
5. 切 WeCom 重做：灰色（comment 命名色），文案一致
6. 切 QQ 重做：普通颜色文字，文案一致
7. 故障路径：在 `Gateway.pushMessage` 内临时 `throw new Error("test")`，重做飞书冒烟，确认：
   - chat 没有灰字通知
   - log 出现 `[gateway] auto-new: recap notify failed for old=…`
   - 主流程的回复正常返回
8. recap 失败路径：临时把 provider `baseURL` 改为不可达地址（仅影响 recap 用的 model），重做冒烟：
   - chat 没有灰字通知
   - log 出现 `[gateway] auto-new: recap failed for old=…`
   - 没有 `notify failed` warn（短路掉了）
9. `bun run typecheck` 通过
10. `bun run check` 通过

## 开放问题

无。所有设计点已确认。

## Roadmap（V1 之后，非本次范围）

- 飞书使用 `collapsible_panel` 折叠完整四段
- 一键 `/resume` 按钮（飞书 interactive button、WeCom 文本快捷指令）
- 失败时也推一条带原因的提醒
- Web 控制台展示 recap 历史 + chat 里改用"打开面板"链接
- 用户可配置文案 / 颜色 / emoji
- i18n
