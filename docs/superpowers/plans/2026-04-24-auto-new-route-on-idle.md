# 空闲自动新建对话 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 chat 空闲达到阈值后自动起新 route、归档旧 route、提示用户，避免上下文无限累积或手动 `/new` 的负担。

**Architecture:** 在 `Gateway.handleMessage` 入口惰性检测 `route.updatedAt` 是否超过 `config.autoNewRoute.idleMinutes`；若超过则在 push user message 前创建新 route、改写 `channelBindings`、对旧 route fire-and-forget 跑一次 recap、并在用户可见的回复流首部 in-band 注入一段提示。配置全局单实例，群聊与私聊行为一致。

**Tech Stack:** TypeScript / Bun，AI SDK v6，zod schema，consola 日志；现有 `RouteStore` / `ChannelBindings` / `generateRecap`。

**Spec:** `docs/superpowers/specs/2026-04-24-auto-new-route-on-idle-design.md`

**Project testing convention:** 本项目无自动化测试套件（见 CLAUDE.md 与用户偏好）。每个 task 的 "verify" 步骤一律使用 `bun run typecheck` + `bun run check`，并在最后一个 task（T6）做一次完整的手动冒烟。**不要**新增 vitest / bun test 文件。

---

## File Plan

| 文件 | 动作 | 责任 |
|---|---|---|
| `packages/common/src/config/schema.ts` | Modify | 新增 `autoNewRouteSchema`，挂到 `configSchema.autoNewRoute`，导出类型 |
| `packages/core/src/recap/summarizer.ts` | Modify | 新增 `archiveRouteWithRecap`：跑 recap + push 到 `route.recaps[]` + 保存 |
| `packages/core/src/commands/recap.ts` | Modify | `/recap` 改为调用 `archiveRouteWithRecap`，去重 |
| `packages/core/src/gateway/gateway.ts` | Modify | T3：stale 检测与切换；T4：prefix 注入（streaming + fallback） |
| `packages/web/src/components/advanced-form.tsx` | Modify | 新增 "对话管理" 三个字段的 UI |
| `packages/web/src/layouts/dashboard-layout.tsx` | Modify | 把 `autoNewRoute` 加入 `SECTION_KEYS.advanced`、`AdvancedValues`、`useState` 初值 |
| `packages/web/src/pages/wizard/index.tsx` | Modify | wizard 第 3 步的 `advancedValues` 初值跟着加 |
| `packages/web/src/i18n/locales/zh.json` | Modify | 新增 `advanced.autoNewRoute.*` 中文键 |
| `packages/web/src/i18n/locales/en.json` | Modify | 同上英文 |

不动：`Route` / `RouteStore` / `ChannelBindings` 接口、`AgentFactory`、channel 适配层（`channel-feishu/wecom/qq`）、系统提示词。

---

## Task 1：新增 `autoNewRoute` 配置 schema

**Files:**
- Modify: `packages/common/src/config/schema.ts`

- [ ] **Step 1：阅读现有 schema 结构定位插入点**

Run: `grep -n "memoryConfigSchema\|configSchema = z" packages/common/src/config/schema.ts`
Expected: 找到 `memoryConfigSchema` 定义和 `configSchema` 顶层 `z.object({` 位置。新 schema 紧随其后插入。

- [ ] **Step 2：在 `memoryConfigSchema` 之后追加 `autoNewRouteSchema` 定义**

在 `packages/common/src/config/schema.ts` 中 `const memoryConfigSchema = ...;` 后面插入：

```ts
const autoNewRouteSchema = z.object({
	enabled: z.boolean().default(true),
	idleMinutes: z.number().int().positive().default(120),
	recap: z.boolean().default(true),
});

export type AutoNewRouteConfig = z.infer<typeof autoNewRouteSchema>;
```

- [ ] **Step 3：在 `configSchema` 顶层挂载字段**

定位 `configSchema = z.object({ ... })` 中 `memory: memoryConfigSchema.optional(),` 那一行（或最后一个字段附近），在它后面追加：

```ts
		autoNewRoute: autoNewRouteSchema.default({
			enabled: true,
			idleMinutes: 120,
			recap: true,
		}),
```

注意缩进用 tab（项目 Biome 配置）。

- [ ] **Step 4：typecheck**

Run: `bun run typecheck`
Expected: 0 errors。`OpenMantisConfig` 现在包含 `autoNewRoute: AutoNewRouteConfig`。

- [ ] **Step 5：lint / format**

Run: `bun run check`
Expected: 0 errors，文件已格式化。

- [ ] **Step 6：commit**

```bash
git add packages/common/src/config/schema.ts
git commit -m "feat(config): add autoNewRoute schema (enabled/idleMinutes/recap)"
```

---

## Task 2：抽出共享 `archiveRouteWithRecap` 并重构 `/recap`

**Files:**
- Modify: `packages/core/src/recap/summarizer.ts`
- Modify: `packages/core/src/commands/recap.ts`

- [ ] **Step 1：在 `summarizer.ts` 文件末尾追加 `archiveRouteWithRecap`**

在 `packages/core/src/recap/summarizer.ts` 顶部 import 区追加（这些都用作类型签名，必须是 `import type`，否则 `route-store` ↔ recap 之间可能构成运行时循环依赖）：

```ts
import type { OpenMantisConfig } from "@openmantis/common/config/schema";
import type { Route } from "../gateway/route";
import type { RouteStore } from "../gateway/route-store";
import type { RecapEntry } from "./types";
```

（如果某些类型已在文件中以非 type-only 方式 import，请合并为 type-only；不要重复 import。）

然后在文件末尾追加函数：

```ts
export async function archiveRouteWithRecap(params: {
	route: Route;
	config: OpenMantisConfig;
	routeStore: RouteStore;
}): Promise<RecapEntry> {
	const { route, config, routeStore } = params;
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
	try {
		await routeStore.save(route);
	} catch (err) {
		logger.warn(`[recap] save route failed (non-fatal): route=${route.id}`, err);
	}
	return entry;
}
```

如果 `summarizer.ts` 顶部已 import 了部分类型，请合并；不要重复 import。`logger` 应在文件头部已存在（`createLogger("core/recap")`）。

- [ ] **Step 2：重构 `commands/recap.ts` 调用新函数**

打开 `packages/core/src/commands/recap.ts`，把 `execute` 函数体替换为：

```ts
		async execute(ctx: CommandContext): Promise<CommandResult> {
			const route = await ctx.routeStore.get(ctx.currentRouteId);
			if (!route) {
				return { type: "display", text: "会话未找到" };
			}

			let entry: RecapEntry;
			try {
				entry = await archiveRouteWithRecap({
					route,
					config: ctx.config,
					routeStore: ctx.routeStore,
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				logger.warn(`[recap] generation failed for route=${ctx.currentRouteId}: ${message}`);
				return { type: "display", text: `生成 recap 失败：${message}` };
			}

			return { type: "display", text: renderRecap(entry.result) };
		},
```

并把顶部 import 行：

```ts
import { generateRecap } from "../recap/summarizer";
import type { GenerateRecapOutput, RecapEntry, RecapResult } from "../recap/types";
```

替换为：

```ts
import { archiveRouteWithRecap } from "../recap/summarizer";
import type { RecapEntry, RecapResult } from "../recap/types";
```

（`GenerateRecapOutput` 不再用到。）

- [ ] **Step 3：typecheck**

Run: `bun run typecheck`
Expected: 0 errors。

- [ ] **Step 4：lint / format**

Run: `bun run check`
Expected: 0 errors。

- [ ] **Step 5：手动验证 /recap 仍然可用（可选 smoke）**

如果当前已有运行的 daemon 且能跑 `/recap`，发送 `/recap` 命令确认仍然返回结构化摘要。如果不方便起，跳过——等 T6 总冒烟。

- [ ] **Step 6：commit**

```bash
git add packages/core/src/recap/summarizer.ts packages/core/src/commands/recap.ts
git commit -m "refactor(recap): extract archiveRouteWithRecap shared by /recap and auto-new"
```

---

## Task 3：Gateway 加 stale 检测与 route 切换

**Files:**
- Modify: `packages/core/src/gateway/gateway.ts`

- [ ] **Step 1：在 gateway.ts 顶部 import 新函数**

确认 `packages/core/src/gateway/gateway.ts` 头部 import 区有这两行（如已存在则跳过）：

```ts
import { archiveRouteWithRecap } from "../recap/summarizer";
```

- [ ] **Step 2：新增 stale 判定纯函数**

在 `Gateway` 类外部、文件靠近顶部的工具函数区（`function buildAgentMessages` 上方或下方）追加：

```ts
function isRouteStale(route: { updatedAt: number; messages: unknown[] }, idleMinutes: number): boolean {
	if (route.messages.length === 0) return false;
	return Date.now() - route.updatedAt > idleMinutes * 60_000;
}
```

- [ ] **Step 3：在 `handleMessage` 入口加 auto-new 块**

定位 `handleMessage` 中现有这段（约 `gateway.ts:266-291`）：

```ts
		const route = await this.routeStore.getOrCreate(
			incoming.routeId,
			incoming.channelType,
			incoming.channelId,
		);
		const isNewRoute = route.messages.length === 0;
		logger.debug(
			`[gateway] route ${isNewRoute ? "created" : "resumed"}: ${route.id}` +
				`, messages: ${route.messages.length}`,
		);

		// Reject concurrent agent messages on a busy route.
		// Slash commands bypass this path entirely (handled at channel layer).
		if (this.inflight.has(route.id)) {
```

把 `const route = ...` 改为 `let route = ...`（后续可能换成新 route），然后在 `if (this.inflight.has(route.id))` **后面**（即 inflight 拒绝块之后），插入 auto-new 检查：

```ts
		// Auto-new-route on idle: if the bound route has been idle past the
		// configured threshold, archive it (recap, fire-and-forget) and bind
		// this chat to a fresh empty route before persisting the new message.
		const autoNewCfg = this.config.autoNewRoute;
		let autoNewTriggered = false;
		if (
			autoNewCfg.enabled &&
			!this.inflight.has(route.id) &&
			isRouteStale(route, autoNewCfg.idleMinutes)
		) {
			const oldRoute = route;
			const newId = `${incoming.channelType}-${incoming.channelId}-${Date.now()}`;
			logger.info(
				`[gateway] auto-new triggered: chat=${incoming.channelType}/${incoming.channelId}, ` +
					`old=${oldRoute.id} (idle ${Math.round((Date.now() - oldRoute.updatedAt) / 60_000)}m, ` +
					`${oldRoute.messages.length} msgs) -> new=${newId}`,
			);
			route = await this.routeStore.create(newId, incoming.channelType, incoming.channelId);
			if (this.channelBindings) {
				try {
					await this.channelBindings.set(incoming.channelType, incoming.channelId, newId);
				} catch (err) {
					logger.warn(`[gateway] auto-new: rebind failed (non-fatal): ${err}`);
				}
			}
			autoNewTriggered = true;
			if (autoNewCfg.recap && oldRoute.messages.length >= 3) {
				archiveRouteWithRecap({
					route: oldRoute,
					config: this.config,
					routeStore: this.routeStore,
				})
					.then((entry) =>
						logger.info(`[gateway] auto-new: recap archived old=${oldRoute.id}, recapId=${entry.id}`),
					)
					.catch((err) =>
						logger.warn(`[gateway] auto-new: recap failed for old=${oldRoute.id}:`, err),
					);
			} else {
				logger.debug(
					`[gateway] auto-new: skipping recap for old=${oldRoute.id} ` +
						`(recap=${autoNewCfg.recap}, msgs=${oldRoute.messages.length})`,
				);
			}
		}
```

`autoNewTriggered` 在 T4 注入 prefix 时使用，本 task 只先把变量声明放进来即可。

- [ ] **Step 4：typecheck**

Run: `bun run typecheck`
Expected: 0 errors（`autoNewTriggered` 暂时未读取，可能会被 noUnusedLocals 提示——本项目 tsconfig 未启用该规则；若报错则把变量改为 `let _autoNewTriggered = false;`，T4 中再恢复）。

- [ ] **Step 5：lint / format**

Run: `bun run check`
Expected: 0 errors。

- [ ] **Step 6：commit**

```bash
git add packages/core/src/gateway/gateway.ts
git commit -m "feat(gateway): auto-create new route after idle threshold"
```

---

## Task 4：Prefix 注入（streaming + fallback）

**Files:**
- Modify: `packages/core/src/gateway/gateway.ts`

- [ ] **Step 1：构造 prefix 字符串**

在 T3 添加的 auto-new 检查块**最后**（`autoNewTriggered = true;` 之后那个 if/else 块都执行完后），追加 prefix 计算：

```ts
		const autoNewPrefix = autoNewTriggered
			? (() => {
					const m = autoNewCfg.idleMinutes;
					const desc = m >= 60 && m % 60 === 0 ? `${m / 60} 小时` : `${m} 分钟`;
					return `🆕 空闲超过 ${desc}，已开启新对话（旧会话已归档，/list 可查看）\n\n`;
				})()
			: "";
```

- [ ] **Step 2：在 `wrappedStream` 首部 yield prefix（streaming 路径）**

定位 `wrappedStream` 生成器（约 `gateway.ts:465`）。当前代码：

```ts
				async function* wrappedStream(): AsyncGenerator<import("./stream-events").StreamEvent> {
					try {
						for await (const ev of toStreamEvents(streamResult.fullStream)) {
```

在 `try {` 后、`for await` 前插入：

```ts
						if (autoNewPrefix) {
							yield { type: "text-delta", text: autoNewPrefix };
						}
```

注意：`wrappedStream` 是嵌套在 try 里的本地 async generator，闭包可见 `autoNewPrefix`。

- [ ] **Step 3：在 fallback generate 路径拼 prefix**

定位 fallback 路径（约 `gateway.ts:489-530`）。当前：

```ts
				const outgoing = buildFallbackResponse({ ...result, text: fallbackText });
```

在它**后面**（在 `await maybeRunAutoTts` 之前）插入：

```ts
				if (autoNewPrefix) {
					outgoing.content = `${autoNewPrefix}${outgoing.content}`;
				}
```

`OutgoingMessage.content` 是字符串类型，可直接前置拼接。

- [ ] **Step 4：typecheck**

Run: `bun run typecheck`
Expected: 0 errors。

- [ ] **Step 5：lint / format**

Run: `bun run check`
Expected: 0 errors。

- [ ] **Step 6：commit**

```bash
git add packages/core/src/gateway/gateway.ts
git commit -m "feat(gateway): inject auto-new notice prefix in stream and fallback paths"
```

---

## Task 5：Web 设置 UI（advanced 区块新增"对话管理"）

**Files:**
- Modify: `packages/web/src/components/advanced-form.tsx`
- Modify: `packages/web/src/layouts/dashboard-layout.tsx`
- Modify: `packages/web/src/pages/wizard/index.tsx`
- Modify: `packages/web/src/i18n/locales/zh.json`
- Modify: `packages/web/src/i18n/locales/en.json`

- [ ] **Step 1：扩展 `AdvancedForm` props 类型与 UI**

打开 `packages/web/src/components/advanced-form.tsx`，把 `AdvancedFormProps.values` 改为：

```ts
interface AdvancedFormProps {
	values: {
		systemPrompt: string
		maxToolRoundtrips: number
		autoNewRoute: {
			enabled: boolean
			idleMinutes: number
			recap: boolean
		}
	}
	onChange: (values: AdvancedFormProps["values"]) => void
}
```

在组件返回的根 `<div>` 里、现有 `maxToolRoundtrips` 字段**之后**追加（保持 tab 缩进）：

```tsx
				<div className="flex flex-col gap-2">
					<Label>{t("advanced.autoNewRoute.enabled")}</Label>
					<div className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={values.autoNewRoute.enabled}
							onChange={(e) =>
								onChange({
									...values,
									autoNewRoute: { ...values.autoNewRoute, enabled: e.target.checked },
								})
							}
						/>
						<span className="text-sm text-muted-foreground">
							{t("advanced.autoNewRoute.enabledHint")}
						</span>
					</div>
				</div>
				<div className="flex flex-col gap-2">
					<Label>{t("advanced.autoNewRoute.idleMinutes")}</Label>
					<Input
						type="number"
						value={values.autoNewRoute.idleMinutes}
						onChange={(e) =>
							onChange({
								...values,
								autoNewRoute: {
									...values.autoNewRoute,
									idleMinutes: Number.parseInt(e.target.value, 10) || 120,
								},
							})
						}
						min={1}
						max={10080}
						disabled={!values.autoNewRoute.enabled}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label>{t("advanced.autoNewRoute.recap")}</Label>
					<div className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={values.autoNewRoute.recap}
							onChange={(e) =>
								onChange({
									...values,
									autoNewRoute: { ...values.autoNewRoute, recap: e.target.checked },
								})
							}
							disabled={!values.autoNewRoute.enabled}
						/>
						<span className="text-sm text-muted-foreground">
							{t("advanced.autoNewRoute.recapHint")}
						</span>
					</div>
				</div>
```

> 注意：项目里其他 form 已有 Switch 等 shadcn 组件。这里为了不在 plan 里额外引入新依赖，先用原生 checkbox。如果 codebase 有 `Switch` 组件且用法明显，实现者可以替换；不替换不算 bug。

- [ ] **Step 2：扩展 `dashboard-layout.tsx` 的状态与 SECTION_KEYS**

打开 `packages/web/src/layouts/dashboard-layout.tsx`：

1. 把 `SECTION_KEYS.advanced` 这一行：
   ```ts
   advanced: ["systemPrompt", "maxToolRoundtrips"],
   ```
   改为：
   ```ts
   advanced: ["systemPrompt", "maxToolRoundtrips", "autoNewRoute"],
   ```

2. 找到 `AdvancedValues` 类型定义（如果是 inline 的，扩展它；若是单独 type alias，扩展它）。在它的字段里加：
   ```ts
   autoNewRoute: {
   	enabled: boolean
   	idleMinutes: number
   	recap: boolean
   }
   ```
   定位办法：`grep -n "AdvancedValues\|advancedValues" packages/web/src/layouts/dashboard-layout.tsx`

3. 在 `useState<AdvancedValues>({...})` 初值里加（参考现有 `systemPrompt: config.systemPrompt ?? ""` 模式）：
   ```ts
   autoNewRoute: config.autoNewRoute ?? { enabled: true, idleMinutes: 120, recap: true },
   ```

- [ ] **Step 3：扩展 wizard 第 3 步的初值**

打开 `packages/web/src/pages/wizard/index.tsx`，找到 `advancedValues` 的 useState 初值（约 `wizard/index.tsx:52`）。当前：

```ts
		systemPrompt: "",
```

附近补完整：

```ts
		systemPrompt: "",
		maxToolRoundtrips: 10,
		autoNewRoute: { enabled: true, idleMinutes: 120, recap: true },
```

（如果已有 `maxToolRoundtrips` 行不要重复。）

- [ ] **Step 4：i18n 文案（zh）**

在 `packages/web/src/i18n/locales/zh.json` 中 `"advanced.maxToolRoundtrips"` 那一行后面追加：

```json
	"advanced.autoNewRoute.enabled": "自动新建对话",
	"advanced.autoNewRoute.enabledHint": "空闲达到阈值后，下条消息自动开启新会话",
	"advanced.autoNewRoute.idleMinutes": "空闲阈值（分钟）",
	"advanced.autoNewRoute.recap": "切换时归档旧会话 recap",
	"advanced.autoNewRoute.recapHint": "对旧会话异步生成结构化摘要存档（消耗一次 LLM 调用）",
```

注意 JSON 末尾逗号——若 `maxToolRoundtrips` 是文件末尾字段，需要在它后面加逗号。

- [ ] **Step 5：i18n 文案（en）**

同样在 `packages/web/src/i18n/locales/en.json` 中追加：

```json
	"advanced.autoNewRoute.enabled": "Auto-new conversation",
	"advanced.autoNewRoute.enabledHint": "After idle threshold, the next message starts a fresh conversation",
	"advanced.autoNewRoute.idleMinutes": "Idle threshold (minutes)",
	"advanced.autoNewRoute.recap": "Recap old conversation on switch",
	"advanced.autoNewRoute.recapHint": "Asynchronously generate a structured recap of the old route (uses one LLM call)",
```

- [ ] **Step 6：typecheck + lint**

Run: `bun run typecheck && bun run check`
Expected: 0 errors。

- [ ] **Step 7：构建 web 验证可以打包**

Run: `bun run build:web`
Expected: 构建成功，无 TS 错误，无 i18n 警告。

- [ ] **Step 8：commit**

```bash
git add packages/web packages/web/src/i18n/locales/zh.json packages/web/src/i18n/locales/en.json
git commit -m "feat(web): add auto-new-route settings UI in advanced section"
```

---

## Task 6：手动冒烟验证

**Files:** none (verification only)

按 spec 的 "手动验证" 一节走一遍。本 task 不修改代码，只确认行为符合预期。

- [ ] **Step 1：起 dev 环境**

Run: `bun run dev:full`
Expected: 后端 daemon 起来，Vite dev server 起来，能在浏览器访问 web 设置页。

- [ ] **Step 2：在 web 设置页把阈值调小**

打开浏览器中的设置 → 高级 / Advanced → "自动新建对话"：
- enabled: ✓
- idleMinutes: 1
- recap: ✓
保存。

按需重启 daemon（如果保存后 hot-reload 没生效）：`openmantis restart`（或 dev 模式下 `bun run dev` 会自动 watch）。

- [ ] **Step 3：基线对话**

在飞书 / WeCom / QQ 任一渠道（或 dev 起来的 channel）发一条消息（例如"你好"），等模型回复完。
执行 `/list` 记下当前 route id（记为 `OLD_ID`）。

- [ ] **Step 4：等阈值**

等 70 秒以上。

- [ ] **Step 5：再发消息触发 auto-new**

发任意消息（例如"在吗"）。
**预期**：
- 回复开头看到 `🆕 空闲超过 1 分钟，已开启新对话（旧会话已归档，/list 可查看）` 后跟正常 agent 回复。
- 同一消息内，前缀和回复在一起。

- [ ] **Step 6：验证新 route 已切换**

执行 `/list`，预期：
- 当前 route 是新 id（标 `*` 或 `✦`），不是 `OLD_ID`。
- `OLD_ID` 仍出现在列表里。

- [ ] **Step 7：验证 recap 已归档到旧 route**

读 `$OPENMANTIS_DATA_DIR/routes/<OLD_ID>.json`（dev 模式下是项目根 `.openmantis/routes/...`）。
预期：`recaps` 数组里多一条 entry，包含 `id / createdAt / messageCount / provider / modelId / result`。

如果旧 route 消息数 `< 3`，`recaps` 不会增加——这是设计内行为，不算 bug。

- [ ] **Step 8：验证 /resume 能回到旧 route**

执行 `/resume <OLD_ID>`，再执行 `/history`。
预期：能看到旧对话所有消息。

- [ ] **Step 9：边界 — recap 关闭**

回设置页，关掉 "切换时归档旧会话 recap"，保存重启。
执行 `/new` 起一个新 route，发 3 条以上消息让它形成历史，等 70 秒，再发消息。
预期：仍切换、仍有前缀；但旧 route JSON 的 `recaps[]` 不再增加。

- [ ] **Step 10：边界 — 全功能关闭**

设置页关闭 "自动新建对话"，保存重启。
等 70 秒后再发消息。
预期：不切换 route，不出现前缀，正常追加到当前 route。

- [ ] **Step 11：边界 — `/clear` 不触发**

打开 auto-new，重启。先发消息让 route 有内容，立刻 `/clear`，等 70 秒，再发消息。
预期：不触发 auto-new（`updatedAt` 已被 clear 刷新）。

- [ ] **Step 12：边界 — 日志检查**

`openmantis log`（或 dev 直接 tail `.openmantis/openmantis.log`），grep `auto-new`。
预期能看到：
- `[gateway] auto-new triggered: chat=...` 开头的 info 日志
- `[gateway] auto-new: recap archived old=...` 或 `recap failed` 信息
- 失败/跳过场景对应的 debug/warn

- [ ] **Step 13：把阈值改回合理值（120）**

设置页把 idleMinutes 改回 120，保存重启。本步只是恢复现场，避免后续日常使用持续被打断。

- [ ] **Step 14：所有边界通过后，无代码改动则不产生 commit**

Run: `git status`
Expected: working tree clean。如果手动验证途中发现 bug 需要回去改 T1-T5 任一 task，修完后单独 commit 修复。

---

## Self-Review Notes

按 spec 章节核对覆盖：

| Spec 章节 | 实现 task |
|---|---|
| 触发点与检查时机 | T3 step 3（`isRouteStale` + 入口检查） |
| 切换流程（步骤 1-6） | T3 step 3（create / rebind / archive / 标志位） |
| Recap 异步归档 | T2 step 1（共享函数） + T3 step 3（调用点 + skip 条件） |
| 用户可见提示 | T4（streaming + fallback 两路径） |
| 配置 schema | T1 + T5（schema 定义 + UI 暴露） |
| 边界情况表 | T3（msgs===0、inflight、enabled、msgs<3、recap=false 全部覆盖）+ T6（/clear、/new、群聊靠运行时验证） |
| 手动验证清单 | T6 |

无 placeholder、无 TBD。命名一致：`autoNewRoute`、`autoNewTriggered`、`autoNewPrefix`、`autoNewCfg`、`isRouteStale`、`archiveRouteWithRecap` 在 plan 内自洽。
