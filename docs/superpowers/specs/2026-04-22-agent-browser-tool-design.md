# agent-browser 工具化重构设计

**日期**：2026-04-22
**状态**：Draft，待实现
**作者**：Claude (brainstorming with @LiangNiang)

## 背景

当前 `agent-browser`（外部 CLI）通过三块拼凑的方式接入 OpenMantis：

1. **SKILL 存根** —— `skills/builtin/agent-browser/SKILL.md` 通过通用 `skills` 工具暴露，仅在 `config.browser.enabled === true` 时才被注册（`packages/core/src/tools/skills.ts:13,279-281`）。
2. **执行通道** —— 模型通过通用 `bash` 工具执行 `agent-browser <subcommand>` 命令；`packages/core/src/tools/bash.ts:225-228, 259-261` 里有针对 `agent-browser` 的特判（拉长 silence 窗口、替换 hint 文案）。
3. **约束注入** —— `packages/core/src/agent/browser-prompt.ts` 往 system prompt 注入一大段 MANDATORY 规则：模型必须每次手动带上 `--session route-<routeId> --profile <abs>`（隔离模式）或 `--cdp <port>` / `--auto-connect`（CDP 模式）；同时承载 CDP 安全守则。

这套架构的问题：
- **三处分散、心智成本高**：一个能力被切到 skills、bash、prompt 三块，新人难以追溯。
- **强制 flag 靠提示工程**：约束依赖 LLM 严格遵守 system prompt，模型一旦遗漏就会污染 profile / 串状态，且没有 runtime 兜底。
- **隐藏破口**：`browser-prompt.ts` 在没有 `routeId` 时会跳过注入，但 SKILL 注册不看 `routeId`，理论上存在「模型能调到 agent-browser 但没有强制 flag 约束」的窗口。
- **bash 工具被污染**：通用工具里写死 `command.includes("agent-browser")` 的字符串特判。

## 目标

把 agent-browser 重构成 OpenMantis 的一等工具组（与 `bash`、`file`、`memory` 等并列），用 runtime 强制取代 prompt 强制，把分散在三处的逻辑收拢到单一文件。

**显式非目标**：
- 不改 `config.browser.*` 的现有配置项（`enabled`、`binPath`、`cdp.port`、`cdp.autoConnect` 全部原样，前端配置 UI 不动）。
- 不为 agent-browser 的每个子命令各写一个工具（避免追随上游 CLI 表面变化）。
- 不内置 agent-browser CLI 自身（仍依赖用户 `npm i -g agent-browser`）。

## 设计

### 工具组成

新增一个 `browser` 工具组，包含三个工具：

| 工具 | 用途 |
|---|---|
| `browser_help` | 加载与已装 CLI 版本匹配的用法文档，等价于 `agent-browser skills get <topic>`。 |
| `browser` | 执行任意 agent-browser 子命令，自动注入 session/profile/cdp 等隔离 flag。 |
| `browser_kill` | 终止某个 `browser` 会话（最后手段）。 |

### `browser` 工具

**Input schema**

```ts
{
  args: string[];              // 必需。子命令 + 参数，如 ["open", "https://example.com"]
  timeout?: number;            // 可选。毫秒。默认 60_000，上限 600_000；超时 SIGKILL
  maxOutputLength?: number;    // 可选。覆盖配置默认；上限 1_000_000
  description?: string;        // 可选。日志可读性
}
```

选用 `args: string[]` 而非 `command: string` 的原因：
- 避免 shell 解析与转义/注入风险；
- 工具内直接 `Bun.spawn([binPath, ...autoFlags, ...args])`，参数边界清晰；
- 仅 `eval --stdin` 这一类需要 heredoc 的场景受影响，可用 `eval "<expr>"` 单引号字符串替代。

**自动 flag 注入**（模型不可见、不可覆盖）

执行前根据 `config.browser.cdp` 决定模式：

| 模式 | 注入的 flag |
|---|---|
| 隔离模式（cdp 未配置或字段都未设） | `--session route-<routeId>`、`--profile <browserProfileDir(routeId)>` |
| CDP autoConnect | `--auto-connect`、`--session route-<routeId>`（**禁止 `--profile`**） |
| CDP port | `--cdp <port>`、`--session route-<routeId>`（**禁止 `--profile`**） |

`binPath` 取 `config.browser.binPath ?? "agent-browser"`。

**Args 安全门**

如果 `args` 中出现 `--session` / `--profile` / `--cdp` / `--auto-connect`，工具立即拒绝并返回 `{ error: "flag X is managed by the tool and must not be passed in args" }`。把原来由 system prompt 强制的约束改成 runtime 强制。

**输出处理**

- stdout + stderr 合并、ANSI 剥离；
- 阈值优先级：per-call `maxOutputLength` > `config.browser.maxOutputLength` > 默认 `100_000`；
- 如果原始输出长度超过阈值：
  - 完整原始输出写入 `<WORKSPACE_DIR>/browser-output/<sessionId>.txt`；
  - `output` 字段返回头尾摘要 + 中间省略提示（与 `bash` 截断格式一致）；
  - 返回值附加 `outputFile: <abs path>`、`outputBytes: <number>`、`outputTruncated: true`。
- 模型可用现有 `file_read` 的 `offset` / `limit` 读取指定行段。

**落盘 LRU 清理**

每次写入 `browser-output/` 后扫描目录，按 mtime 保留最新 50 个文件，超出删除最旧。**不做启动期清理**（避免多实例互相清）。

**返回**

```ts
{
  sessionId: string;                    // "browser_<8hex>"
  output: string;                       // 截断或完整
  status: "exited" | "timeout";
  exitCode?: number;
  outputFile?: string;                  // 仅截断时存在
  outputBytes?: number;                 // 仅截断时存在
  outputTruncated?: true;               // 仅截断时存在
}
```

`status: "exited"` 时立即从 sessions Map 删除；`status: "timeout"` 时在 SIGKILL 之后删除。

**Description（运行时拼接）**

CDP 关闭时：
> Run an `agent-browser` subcommand. Pass the subcommand and its args as `args[]` (e.g. `["open","https://example.com"]`, `["snapshot","-i"]`). Session and profile flags are managed automatically — do NOT pass `--session`, `--profile`, `--cdp`, or `--auto-connect`. Default timeout 60s; for long waits/downloads pass `timeout` explicitly. Returns stdout/stderr in `output`; outputs over the threshold spill to `outputFile` (use `file_read` with offset/limit to inspect). Use `browser_help` first if you don't know the subcommand to use.

CDP 启用时，追加 ~8 行 CDP 安全守则（替代 `browser-prompt.ts` 第 2 部分）：
> CDP MODE: This browser shares cookies and login state with the user's real Chrome. NEVER perform destructive or irreversible actions without explicit user confirmation. This includes (non-exhaustive): logging out, deleting data, sending messages, posting content, submitting forms, making purchases, changing account settings, revoking access. When in doubt, stop and ask the user — do not guess.

### `browser_kill`

**Input**：`{ sessionId: string }`

**行为**：
- 在 sessions Map 查找；
- 找到且未退出 → `proc.kill("SIGKILL")` → 等 `proc.exited` → 删表项；
- 找到但已退出 / 找不到 → 返回 `{ error, status: "exited" }`。

**返回**：
```ts
{ output: string; status: "exited"; exitCode: number; }
```

**Description**：
> Terminate a running `browser` session. Use ONLY when a command is truly stuck (e.g. blocked by a system dialog the user can't dismiss) or the user explicitly asks to stop it. Returns any output captured before termination. Slow commands that are working normally — wait them out via a longer `timeout` on the next call instead of killing.

注：`browser` 工具是同步执行模型，模型在自己调用阻塞期间无法插入 `browser_kill`；该工具的真正用途是**并发会话**场景（用户在另一条消息里要求停止）。与 `bash_kill` 形态对称，实现成本低，保留。

### `browser_help`

**Input**：`{ topic?: string }`，默认 `"core"`，可选 `"core --full"` / `"electron"` / `"slack"` / `"dogfood"` / `"vercel-sandbox"` / `"agentcore"`。

**行为**：
- 内部 `Bun.spawn([binPath, "skills", "get", ...topic.split(" ")])`，30s 超时；
- stdout 作为 `instructions` 字段返回；
- 失败提示「检查 agent-browser 是否安装」。

**返回**：
```ts
{ success: true; topic: string; instructions: string; }
// 或
{ success: false; error: string; }
```

**Description**：
> Load `agent-browser` usage documentation. Call this BEFORE issuing any non-trivial `browser` command — the docs are version-matched to the installed CLI and explain the snapshot/ref workflow, common patterns, and troubleshooting. Default `topic` is `"core"` (overview + common patterns). Pass `"core --full"` for the full command reference; pass `"electron"` / `"slack"` / `"dogfood"` / `"vercel-sandbox"` / `"agentcore"` for specialized workflows.

### `BROWSER_TOOL_GUIDE`

汇入 `resolveTools` 收集的 `toolGuides`，与 `BASH_TOOL_GUIDE`、`FILE_TOOL_GUIDE` 同级：

> ## Browser Tools Usage Guide
> - **`browser_help`**: Read this FIRST. Loads version-matched usage docs from the installed CLI. Default topic `"core"` covers the snapshot-and-ref loop, navigation, interaction, waiting, and common workflows.
> - **`browser`**: Run an `agent-browser` subcommand. Pass `args` as a string array. Session/profile/CDP flags are auto-managed — passing them yourself is rejected. For long waits or downloads, pass an explicit `timeout`. Outputs over `~100K` chars spill to `outputFile`; use `file_read` to inspect specific ranges.
> - **`browser_kill`**: Last-resort termination. Prefer a longer `timeout` over killing.

## 配置

新增**一个**可选字段，其余完全保持不变：

```ts
const browserConfigSchema = z.object({
  enabled: z.boolean().default(false),
  binPath: z.string().default("agent-browser"),
  cdp: browserCdpConfigSchema.optional(),
  maxOutputLength: z.number().int().positive().optional(),  // 新增；不设则用 100_000
});
```

前端 `tools-form.tsx` **不需要为 `maxOutputLength` 加 UI**（高级用户编 config.json 即可，与 `bash.maxOutputLength` 对称）。

## 集成点改动

### `packages/core/src/tools/index.ts`

`ALL_TOOL_GROUPS` 加入 `"browser"`，新增 case：

```ts
case "browser": {
  if (config?.browser?.enabled !== true) break;
  if (!channelCtx?.routeId) {
    logger.debug("[resolveTools] skipping browser tools: no routeId");
    break;
  }
  const browserTools = createBrowserTools(config, channelCtx);
  Object.assign(tools, browserTools);
  guides.push(BROWSER_TOOL_GUIDE);
  break;
}
```

并 export `createBrowserTools`。

### `packages/core/src/tools/skills.ts`

删除 `BROWSER_SKILL_NAME` 常量与 `if (config?.browser?.enabled !== true) skills = skills.filter(...)` 分支。skills 工具不再感知 browser 的存在。

### `packages/core/src/tools/bash.ts`

删除 `agent-browser` 特判：
- 第 225-228 行的 `effectiveSilenceMs = command.includes("agent-browser") ? Math.max(silenceTimeoutMs, 15_000) : silenceTimeoutMs` → 改回 `effectiveSilenceMs = silenceTimeoutMs`；
- 第 259-261 行的 `result.hint = command.includes("agent-browser") ? "..." : "..."` → 改回单一通用 hint。

### `packages/core/src/agent/factory.ts`

删除 `import { buildBrowserPromptSection } from "./browser-prompt"` 与 第 88-91 行注入：
```ts
const browserSection = buildBrowserPromptSection(this.config, options?.routeId);
if (browserSection) {
  instructions += `\n\n${browserSection}`;
}
```

### 文件删除

- `packages/core/src/agent/browser-prompt.ts`（整个文件）
- `skills/builtin/agent-browser/`（整个目录）

### 不动

- `packages/common/src/config/schema.ts` —— `browserConfigSchema` 仅新增可选 `maxOutputLength`，其余不动；`browserCdpConfigSchema`、`isBrowserCdpActive` 原样。
- `packages/common/src/paths/index.ts` —— `browserProfileDir(routeId)` 原样（browser.ts 用它）。
- `packages/core/src/gateway/route-store.ts` —— 清理 profile dir 的逻辑原样。
- `packages/web/src/components/tools-form.tsx` —— 前端配置 UI 原样。

## 错误处理

| 情形 | 处理 |
|---|---|
| `args` 为空 | 立即返回 `{ error: "args must contain at least the subcommand" }` |
| `args` 含被托管 flag | 立即返回 `{ error: "flag '<flag>' is managed by the tool and must not be passed in args" }` |
| binPath 找不到 / 无执行权限 | `Bun.spawn` 抛错，捕获后返回 `{ error: "agent-browser binary not found at <binPath>: <reason>", status: "exited", exitCode: -1 }` |
| 超时 | SIGKILL，返回 `{ status: "timeout", output: <截断>, exitCode: -1 }` |
| 落盘失败 | 不抛错；降级为「不溢出」（截断后只返回 `output`，不返回 `outputFile`），并 `logger.warn` |
| `browser_help` 跑 `skills get` 失败 | 返回 `{ success: false, error: "..." }`，描述里提示检查 agent-browser 安装 |

## 安全考虑

1. **Session/profile 隔离仍是首要保证**：runtime args 校验（拒绝 `--session` / `--profile` / `--cdp` / `--auto-connect`）替代了原 prompt 的强制约束，且更严格 —— 模型不可能绕过。
2. **CDP 模式安全守则**：折入工具描述，CDP 启用时模型在每个工具调用建议处都能看到。
3. **没有 routeId → 工具不暴露**：消除了原架构里「模型能调到 agent-browser 但没有 flag 约束」的隐藏窗口。
4. **`browser_help` 的 topic 仅传给 `skills get`**：通过 `Bun.spawn` 数组形式传参，没有 shell 注入面；topic 内容会被 `.split(" ")` 分词后传给 spawn，最坏情况是模型传无效 topic → CLI 自身报错。

## 已知限制

- **`browser-output/` 文件不跟随 route 生命周期清理**：sessionId 是随机的 `browser_<8hex>`，与 routeId 无对应关系，所以 `route-store.ts` 删除路由时无法精确清理这条路由产生的溢出文件。统一由 LRU（保留最新 50 个）兜底；最坏情况是已删路由的输出文件存留若干天，无安全影响（内容只是页面快照/DOM/JSON）。
- **多实例共享同一 `WORKSPACE_DIR` 时，LRU 扫描存在竞态**：两个 OpenMantis 实例并发写入时可能互相删对方的较旧文件。属于多实例共享 workspace 的通用问题，不在本次重构范围内。
- **同步执行模型下 `browser_kill` 实际仅在并发会话场景可用**：单条对话内模型自己阻塞在 `browser` 调用时无法插入 kill。这是工具选用同步模型（而非 pty）的明确取舍。

## 实现顺序建议

1. 创建 `packages/core/src/tools/browser.ts`，实现三个工具与 `BROWSER_TOOL_GUIDE`，`createBrowserTools(config, channelCtx)` 导出。
2. `packages/common/src/config/schema.ts` 新增 `maxOutputLength` 可选字段。
3. `packages/core/src/tools/index.ts` 新增 `"browser"` group + case + export。
4. 跑一次 `bun run typecheck`，确认 ts 通过。
5. 删除 `packages/core/src/tools/skills.ts` 里的 browser 相关代码。
6. 删除 `packages/core/src/tools/bash.ts` 里的 agent-browser 特判。
7. 删除 `packages/core/src/agent/factory.ts` 里的 `buildBrowserPromptSection` 调用与 import。
8. 删除 `packages/core/src/agent/browser-prompt.ts` 文件。
9. 删除 `skills/builtin/agent-browser/` 目录。
10. `bun run check && bun run typecheck`。
11. 用户手动冒烟：开 browser，跑一次 `browser_help` + `browser ["open","https://example.com"]` + `browser ["snapshot","-i"]`，验证 session 命名、profile 路径、超阈值落盘。
12. CDP 模式手动冒烟：配 `cdp.autoConnect: true` 或 `cdp.port`，验证 `--profile` 不被注入、安全守则在 description 里出现。
