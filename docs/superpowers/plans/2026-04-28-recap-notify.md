# Auto-Recap 完成通知 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `autoNewRoute` 触发的 fire-and-forget recap 生成成功后，往原 chat 推一条灰字单行通知（飞书 / WeCom 灰色，QQ 普通色），告诉用户上次聊了啥并指向 `/list`。

**Architecture:** 新增一个纯函数 `formatRecapNotice(channelType, heading)` 按渠道生成不同 markdown 包裹；改 Gateway 现有的 `archiveRouteWithRecap(...).then(...)` 处理器，在 log 之后调用 `this.pushMessage`，独立 try/catch 防止"通知失败"被记成"recap 失败"。`/recap` 命令路径不受影响。

**Tech Stack:** TypeScript / Bun，consola 日志；现有 `Gateway.pushMessage` + 三个 channel adapter 的 `pushMessage` 实现。

**Spec:** `docs/superpowers/specs/2026-04-28-recap-notify-design.md`

**Project testing convention:** 本项目无自动化测试套件（见 CLAUDE.md 与既有 plan 约定）。每个 task 的 verify 步骤一律 `bun run typecheck` + `bun run check`；最后做一次完整手动冒烟。**不要**新增 vitest / bun test 文件。

---

## File Plan

| 文件 | 动作 | 责任 |
|---|---|---|
| `packages/core/src/recap/notice.ts` | Create | 导出 `formatRecapNotice(channelType, heading): string`，纯函数，无依赖 |
| `packages/core/src/gateway/gateway.ts` | Modify | 扩展 `archiveRouteWithRecap(...).then(...)`：log 之后调 `this.pushMessage`，独立 try/catch |

不动：`packages/core/src/recap/summarizer.ts`（`archiveRouteWithRecap` 保持纯归档原语）、`packages/core/src/commands/recap.ts`（`/recap` 命令）、三个 channel adapter（`pushMessage` 签名不变）、`Route` / `RouteStore` / 配置 schema、`tools/message.ts`。

---

## Task 1：新增 `formatRecapNotice` 纯函数

**Files:**
- Create: `packages/core/src/recap/notice.ts`

- [ ] **Step 1：创建文件并写入函数实现**

新建文件 `packages/core/src/recap/notice.ts`，写入以下完整内容（注意缩进用 tab，符合 Biome 配置）：

```ts
/**
 * Render a one-line "recap archived" notice for chat push, picking the
 * right markdown wrapping per channel.
 *
 * - feishu*  → <font color='grey'>...</font>  (interactive card markdown)
 * - wecom*   → <font color="comment">...</font>  (only 3 named colors supported)
 * - qq / others → plain text (QQ Bot markdown does not render <font>)
 */
export function formatRecapNotice(channelType: string, heading: string): string {
	const body = `📋 上次对话已归档：${heading}（/list 可查看）`;
	if (channelType.startsWith("feishu")) return `<font color='grey'>${body}</font>`;
	if (channelType.startsWith("wecom")) return `<font color="comment">${body}</font>`;
	return body;
}
```

- [ ] **Step 2：typecheck**

Run: `bun run typecheck`
Expected: 0 errors。

- [ ] **Step 3：lint / format**

Run: `bun run check`
Expected: 0 errors，文件已格式化（应该只是确认文件已用 tab 缩进、双引号）。

- [ ] **Step 4：commit**

```bash
git add packages/core/src/recap/notice.ts
git commit -m "$(cat <<'EOF'
feat(recap): add formatRecapNotice helper for per-channel push wrapping

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2：Gateway 在 recap archive 成功后推送通知

**Files:**
- Modify: `packages/core/src/gateway/gateway.ts`

- [ ] **Step 1：在 import 区追加 `formatRecapNotice`**

打开 `packages/core/src/gateway/gateway.ts`，定位现有这一行（约 `gateway.ts:14`）：

```ts
import { archiveRouteWithRecap } from "../recap/summarizer";
```

在它**下面**追加一行：

```ts
import { formatRecapNotice } from "../recap/notice";
```

（保持 import 区按字母/路径排序的话，也可以紧挨 `summarizer` 那条，无强约束。Biome 不强制 import 排序。）

- [ ] **Step 2：替换 `archiveRouteWithRecap(...).then(...)` 处理器**

定位 `gateway.ts:329-342` 这段（在 `if (autoNewCfg.recap && oldRoute.messages.length >= 3) {` 之内）：

```ts
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
```

把 `.then(...)` 部分替换为 async 处理器，扩展为 log + push：

```ts
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
```

要点：
- `.then(async (entry) => { ... })` —— async 箭头函数返回 promise，外层 `.then` 仍是同一条链。
- 内层 try/catch 包裹 `pushMessage` 而不是把整个 `.then` 体放进 try——这样 push 失败不会被外层 `.catch` 误记为 "recap failed"。
- `incoming.channelType` 与 `incoming.channelId` 通过闭包捕获，与 `oldRoute` 一致；`handleMessage` 上下文活到 promise resolve，无生命周期问题。
- 不重试 push 失败：recap 已保存到 `route.recaps[]`，用户随时可 `/list` + `/resume` 主动看。

- [ ] **Step 3：typecheck**

Run: `bun run typecheck`
Expected: 0 errors。

- [ ] **Step 4：lint / format**

Run: `bun run check`
Expected: 0 errors。

- [ ] **Step 5：commit**

```bash
git add packages/core/src/gateway/gateway.ts
git commit -m "$(cat <<'EOF'
feat(gateway): push recap heading notice after auto-new archive

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3：手动冒烟验证

**Files:** none（verification only）

按 spec "手动验证" 一节执行；本 task 不修改代码，只确认行为符合预期。

- [ ] **Step 1：起 dev 环境**

Run: `bun run dev`
Expected: daemon 起来，飞书 / WeCom / QQ channel 按配置 init；log scope `core/gateway` 与 `core/recap` 都活跃。

如果配置里只有飞书生效，下面 Step 5/Step 6 涉及 WeCom / QQ 的步骤可以跳过——已经走过相同代码路径。

- [ ] **Step 2：确认 `idleMinutes` 已调小（便于触发）**

打开 `.openmantis/config.json`，确认 `autoNewRoute`：

```json
{
  "autoNewRoute": {
    "enabled": true,
    "idleMinutes": 1,
    "recap": true
  }
}
```

如果 `idleMinutes` 不是 1，先临时改成 1（冒烟完恢复）；如果 `recap: false`，改成 `true`。

如改了，重启：`bun run dev` 重启或 daemon 模式下 `openmantis restart`。

- [ ] **Step 3：飞书冒烟**

在飞书私聊里：

1. 发任意消息（例如"你好"），等模型回复完。`/list` 记下当前 route id（记为 `OLD_ID`）。
2. 等 70 秒以上。
3. 再发任意消息（例如"在吗"）。

**预期**：
- 第一回复正常返回，开头有 `🆕 空闲超过 1 分钟，已开启新对话（旧会话已归档，/list 可查看）` 前缀。
- 大约 30–90 秒后，chat 里**多出一条独立消息**：`📋 上次对话已归档：<heading>（/list 可查看）`。
- 这条消息渲染为**灰色文字**（飞书卡片识别 `<font color='grey'>`）。
- 完整消息只有一行，没有四段内容。

- [ ] **Step 4：验证旧 route 的 recap 已归档**

查看 `.openmantis/routes/<OLD_ID>.json`，预期 `recaps` 数组多一条 `{ id, createdAt, messageCount, provider, modelId, result }`，`result.heading` 内容与 chat 里那条灰字消息后半截一致。

- [ ] **Step 5：WeCom 冒烟（如已配置）**

在 WeCom 里重复 Step 3 的三步流程。
**预期**：灰字消息出现，颜色为企业微信 `comment` 命名色（视觉上是次要灰）。文案与飞书完全一致。

- [ ] **Step 6：QQ 冒烟（如已配置）**

在 QQ 里重复 Step 3 的三步流程。
**预期**：通知消息出现，**普通颜色**文字（QQ Bot 不渲染 `<font>` 标签是已知约定）。文案与其他渠道一致。

- [ ] **Step 7：日志验证**

`tail .openmantis/openmantis.log`，grep `auto-new`：

```bash
grep "auto-new" .openmantis/openmantis.log | tail -20
```

预期能看到：
- `[gateway] auto-new triggered: ...`
- `[recap] generate: route=...`
- `[recap] success: route=...`
- `[gateway] auto-new: recap archived old=..., recapId=...`
- **没有** `recap notify failed` warn

- [ ] **Step 8：边界 — push 失败路径**

模拟 `pushMessage` 失败：临时把 `Gateway.pushMessage` 第一行改为 `throw new Error("smoke test");`（约 `gateway.ts:225` 后的方法体），重启 daemon。

重做 Step 3 的三步触发 auto-new：

**预期**：
- 第一回复仍然正常返回（含前缀）。
- chat 里**没有**灰字通知（push 直接抛了）。
- log 里出现 `[gateway] auto-new: recap notify failed for old=...` warn。
- log 里**没有** `recap failed` warn（recap 本身成功）。
- `routes/<OLD_ID>.json` 的 `recaps[]` 仍然多一条（recap 已归档）。

测完**还原** `pushMessage` 那行，重启。

- [ ] **Step 9：边界 — recap 关闭路径**

把 config 的 `autoNewRoute.recap` 改为 `false`，重启。

发消息让 route 有 ≥ 3 条历史，等 70 秒，再发消息：

**预期**：
- auto-new 仍触发（前缀照旧）。
- log 里出现 `[gateway] auto-new: skipping recap` debug。
- chat 里**没有**灰字通知。
- 旧 route JSON 的 `recaps[]` 不增加。

测完把 `recap` 改回 `true`。

- [ ] **Step 10：恢复 idleMinutes**

把 `idleMinutes` 改回平时使用的值（如 120），重启。本步只是恢复现场。

- [ ] **Step 11：清场提交（如无代码改动）**

Run: `git status`
Expected: working tree clean。如果手动验证途中发现 bug 改回 T1/T2，修完后单独 commit 修复。

---

## Self-Review Notes

按 spec 章节核对覆盖：

| Spec 章节 | 实现 task |
|---|---|
| § 模块布局：新建 `notice.ts` | T1 |
| § `formatRecapNotice` 设计 | T1（完整函数体已展开） |
| § Gateway 改动 | T2（before/after diff 已展开） |
| § 数据流 | T2 step 2 末段说明闭包捕获 |
| § 边界情况：recap 生成失败 | 现有 `.catch` 不动，T2 step 2 保留外层 catch |
| § 边界：pushMessage 抖动 / 不支持 | T2 step 2 内层 try/catch；T3 step 8 验证 |
| § 边界：用户在新 route 流式中 recap 完成 | 由 channel API 的天然顺序保证，无需特殊处理 |
| § 边界：heading 为空 / 含 `<>` | spec 明确决定不加防御，本计划无对应 task（一致） |
| § 边界：`/recap` 命令路径不触发推送 | T2 不动 `commands/recap.ts`，自然隔离 |
| § 边界：`messages.length < 3` 跳过 | 现有外层 `if` 条件兜底，T2 不改条件 |
| § 边界：`autoNewRoute.recap === false` | 同上；T3 step 9 验证 |
| § 边界：`autoNewRoute.enabled === false` | 现有外层 if 兜底，无验证压力（与既有行为相同） |
| § 手动验证 | T3 全 11 步覆盖飞书 / WeCom / QQ / 日志 / push 失败 / recap 关闭 / 现场恢复 |

**Placeholder 扫描**：无 TODO / TBD / "适当处理" 等模糊措辞。

**类型一致**：`formatRecapNotice(channelType: string, heading: string): string` 在 T1 定义、T2 调用，签名一致；`channelType` 与 `incoming.channelType` 类型相同（`string`）；`heading` 来自 `entry.result.heading`，spec § 数据模型定义为 `string`。

**命名一致**：`formatRecapNotice` 在 plan 与 spec 内一致，无重命名漂移。
