# Subagent Dispatch — Design Spec

**Date:** 2026-04-17
**Status:** Draft — awaiting user review

## 背景与目标

OpenMantis 当前的 `ToolLoopAgent`（Vercel AI SDK）只有单个 agent 循环，父 agent 无法把任务派发给"一个独立 context 的子 agent"。接入 superpowers 的 `subagent-driven-development` 这类 skill 受阻，且无法并行跑多个独立子任务。

本设计新增一个通用的 `subagent` 工具作为核心 primitive，解决两件事：

1. **Context 隔离**——每个子 agent 跑在干净 context 里，不继承父 agent 的对话历史、memory、渠道人格，防止长任务污染父 context
2. **并行执行**——父 agent 在同一步里发起多个 `subagent` 调用时天然并发（AI SDK 默认行为），实现 fan-out

非目标：不做专门针对 coding 流程的角色封装（implementer / reviewer 等）。那些是 skill 层的事，本设计只提供底层 primitive。

## 架构概览

```
父 ToolLoopAgent (channel mode, full tools)
       │
       │ 调 subagent({ prompt, systemPrompt?, provider? })
       ▼
┌──────────────────────────────────────────────┐
│ subagent tool                                │
│  (packages/core/src/tools/subagent.ts)       │
│                                              │
│  1. 读 depth from AsyncLocalStorage          │
│     depth ≥ 2 → error 返回                    │
│  2. 全局 Semaphore(8) acquire                │
│  3. AbortController(300s) + AbortSignal.any  │
│     与父 signal 联动                          │
│  4. AgentFactory.createHeadless()            │
│     （削减工具集 + 无 channel context）       │
│  5. depthStorage.run({ depth+1 }, () =>      │
│       agent.generate(...))                   │
│  6. release semaphore + clearTimeout         │
│  7. return { success, text, error? }         │
└──────────────────────────────────────────────┘
       │
       ▼
子 ToolLoopAgent (headless, 削减后的 tools)
  │
  └─ 若递归调 subagent：depth=1 → 孙 (depth=2)
      └─ 孙再调 subagent：depth=2 → 被拦截
```

关键设计决策：

- **并发由 AI SDK 天然支持**——父 agent 在同一 step 里发起多个 `subagent` 调用，AI SDK 会并行执行。我们不做任何调度
- **深度追踪走 `AsyncLocalStorage`**——跨异步 boundary 无需显式传参
- **父中断向下级联**——用 `AbortSignal.any` 把父 abortSignal 与超时 signal 组合，父 agent 被中断时所有子/孙 agent 一起停

## 工具契约

```ts
subagent({
  prompt: string,            // 必传，单轮任务描述
  systemPrompt?: string,     // 可选，覆盖默认模板
  provider?: string,         // 可选，不传用 config.defaultProvider
})
// → { success: true, text: string }
// → { success: false, error: string }
```

### 默认工具集（子 agent 可见）

**允许**：`bash`、`file`、`search`、`tavily`、`exa`、`rss`、`skills`、`subagent`（递归）

**屏蔽**：`memory_*`、`schedule_*`、`message_*`、渠道特定发消息工具、`tts`、`whisper`

原则：凡是会在**全局范围**（用户记忆、渠道消息、cron 表）留痕的工具，默认屏蔽；纯本地计算的都放开。

### 默认 system prompt 模板

```
You are a subagent dispatched by another agent.
Your response will be returned as a tool result.
Be direct and concise. No chitchat, no clarifying questions, no meta-commentary.
If the task is unclear, make the most reasonable interpretation and proceed.
Return only the final answer.
```

调用方传 `systemPrompt` 时完全覆盖（不叠加）。

## 安全限制（全 hardcoded，不进配置）

| 限制 | 值 | 行为 |
|---|---|---|
| `MAX_DEPTH` | 2 | 父→子→孙；孙再 dispatch → error |
| `MAX_CONCURRENCY` | 8 | 全进程级 semaphore；超过**等待排队**（不失败） |
| `TIMEOUT_MS` | 300_000 (5min) | 到点 `abortController.abort()` → 返回 error |
| `maxSteps` | 继承 `config.maxToolRoundtrips` | 耗尽算 success（返回最后一轮 text） |

## 组件与文件清单

### 新增文件

**`packages/core/src/tools/subagent.ts`** (~150 行)

- 导出 `createSubagentTools(config: OpenMantisConfig): Record<string, Tool>`
- 模块级私有：
  - `semaphore`：8 槽位 queue（手写，~15 行）
  - `depthStorage: AsyncLocalStorage<{ depth: number }>` (from `node:async_hooks`)
- 常量：`DEFAULT_ALLOWED_TOOL_GROUPS`、`MAX_DEPTH`、`MAX_CONCURRENCY`、`TIMEOUT_MS`、默认 system prompt 字符串

### 修改文件

**`packages/core/src/agent/factory.ts`**

给 `AgentFactory` 加 `createHeadless` 方法：

```ts
interface CreateHeadlessOptions {
  systemPrompt?: string;
  provider?: string;
  allowedToolGroups: string[];
}

async createHeadless(options: CreateHeadlessOptions): Promise<CreateAgentResult>
```

说明：`createHeadless` 只负责**构建 agent**（和现有 `create()` 一致）。`prompt` 和 `abortSignal` 在调用方 `agent.generate({ prompt, abortSignal })` 时才传入，不进构造选项。

实现复用 `createLanguageModel`、`resolveThinkingOptions`、`resolveTools`，但：

- `resolveTools` 第三参（`channelCtx`）传 `undefined`
- 不调 `memoryStore.loadCore()`
- 不走 `buildStructuredPrompt` 和 `buildBrowserPromptSection`
- system prompt = `options.systemPrompt ?? DEFAULT_SUBAGENT_PROMPT`
- `excludeGroups` = `ALL_TOOL_GROUPS` 减 `options.allowedToolGroups`

**`packages/core/src/tools/index.ts`**

- `ALL_TOOL_GROUPS` 常量元组加 `"subagent"`
- `resolveTools` 的 switch 加 `case "subagent"` 分支调 `createSubagentTools(config)`
- 顶部 export 增加 `createSubagentTools`

### 不改动

- `packages/common/src/config/schema.ts`——零配置变更
- `packages/core/src/agent/prompts.ts`
- 所有 channel 包

### 关掉入口

因为 `"subagent"` 进了 `ALL_TOOL_GROUPS`，用户不想启用时可在配置写 `"excludeTools": ["subagent"]`——复用现有机制，无需新增 flag。

### 外部依赖

不新增 npm 依赖。`AsyncLocalStorage` 来自 Node/Bun 内置 `node:async_hooks`；信号量手写。

## 数据流（单次调用完整时序）

```
父 agent 的一个 step
  ├─ 模型决定调用 subagent({ prompt, systemPrompt?, provider? })
  │
  └─ AI SDK 执行 subagent.execute(args, { abortSignal })
       │
       ├─ [1] depth = depthStorage.getStore()?.depth ?? 0
       │      if depth >= MAX_DEPTH
       │         → return { success: false,
       │                    error: "Max subagent depth (2) exceeded. ..." }
       │
       ├─ [2] await semaphore.acquire()   // 最多 MAX_CONCURRENCY
       │
       ├─ [3] timeoutCtrl = new AbortController()
       │      linkedSignal = AbortSignal.any([abortSignal, timeoutCtrl.signal])
       │      timer = setTimeout(() => timeoutCtrl.abort("timeout"), TIMEOUT_MS)
       │
       ├─ [4] factory = new AgentFactory(config)
       │      { agent } = await factory.createHeadless({
       │        systemPrompt, provider,
       │        allowedToolGroups: DEFAULT_ALLOWED_TOOL_GROUPS,
       │      })
       │
       ├─ [5] result = await depthStorage.run(
       │        { depth: depth + 1 },
       │        () => agent.generate({ prompt, abortSignal: linkedSignal })
       │      )
       │
       ├─ [6] clearTimeout(timer); semaphore.release()
       │
       └─ [7] return { success: true, text: result.text }
```

### 关键细节

- **`abortSignal` 链式传递**：父被中断 → 所有活跃子/孙 agent 立即停
- **`depthStorage.run()` 的作用域**：在回调里执行的所有异步代码（包括子 agent 内部调用的 tool execute、它再发起的 subagent 调用）都能读到 `{ depth: N }`，不用显式传参
- **并发不阻塞父的其他工具**：父同一 step 发起 10 个 subagent，前 8 立即跑，后 2 await semaphore；父 agent 同 step 里的其他 tool（如 bash）不受影响——semaphore 只锁在 subagent 这一个 tool 的 execute 里

## 错误处理

**原则**：subagent 工具不 throw，所有预期失败走结构化返回 `{ success: false, error: string }`。父 agent 由模型读 error 文本自行决定重试 / 换参。

| 错误 | 触发 | 行为 |
|---|---|---|
| 深度超限 | `depth >= 2` | `{ success: false, error: "Max subagent depth (2) exceeded. ..." }` |
| 超时 | 300s 未完成 | `{ success: false, error: "Subagent timed out after 300s" }` |
| 父中断 | 外层 abortSignal 触发 | **throw AbortError**（不吞；让 ToolLoopAgent 按标准语义终止循环） |
| Provider 不存在 | `resolveProvider` 抛错 | 透传其 message 作为 error |
| 模型 API 失败 | 429 / 网络 / 5xx | `{ success: false, error: "Subagent failed: <err.message>" }` |
| 子 agent 内部工具报错 | 例如 bash 返回非零 | **不是错误**——子 agent 的模型会读 tool 结果继续；只要最终出 text 就 success |
| 步数耗尽 | 达到 `maxToolRoundtrips` | **success: true**，返回最后一轮 text（AI SDK 默认） |

### 选择背后的理由

- **父中断为什么要 throw 而不是结构化返回？** 中断意味整条链路该停，返回结构化 error 只会让父 agent 再起新的 subagent，白烧钱
- **为什么步数耗尽算成功？** AI SDK 的 `stepCountIs` 行为是"达到上限就停并返回最后一轮文本"——和正常结束同一路径。硬转 error 会丢信息；父 agent 应看 text 质量自行判断
- **为什么不区分 retriable vs fatal？** 模型读 `error` 字符串自行判断比我们搞 error code 更灵活。error message **要写得人类可读、带足诊断信息**

### 日志

每次 subagent 调用记录 `depth`、`provider`、prompt 前 100 字、最终 `success`/`error`、耗时 → `logger.debug`。生产 `LOG_LEVEL=info` 仅记录失败。

## 使用示例

### 单次调用

```
父 agent 模型输出:
  I need to research A and B independently.
  subagent({ prompt: "深入研究 A 并给出 3 点结论" })
  → { success: true, text: "结论 1...\n结论 2...\n结论 3..." }
```

### 并行 fan-out

```
父 agent 同一步发起 3 个调用（AI SDK 自动并发）:
  subagent({ prompt: "研究 A" })   ┐
  subagent({ prompt: "研究 B" })   ├─ 同时跑
  subagent({ prompt: "研究 C" })   ┘
  → 3 个结果一起回来，父 agent 汇总
```

### 覆盖 system prompt

```
subagent({
  prompt: "审阅以下代码：...",
  systemPrompt: "You are a strict code reviewer. ...",
})
```

## Verification（手动冒烟清单）

实现完成后，由作者按以下场景手动跑一遍，确认：

1. **单次调用**：父 agent 调 subagent → 返回正常 text
2. **并行 fan-out**：父同步发起 3 个 subagent 调用 → 日志能看到 3 个同时执行、耗时接近串行的 1/3
3. **超时**：构造让子 agent 卡住的 prompt（比如让它在 bash 里 `sleep 500`）→ 300s 后返回 `{ success: false, error: "timed out" }`
4. **深度拦截**：诱导孙 agent 调 subagent → 返回 `{ success: false, error: "Max subagent depth..." }`
5. **父中断传播**：父 agent 启动子 agent 后用户 `/stop` → 子 agent 立即终止（日志无 stuck step）
6. **工具隔离**：子 agent 尝试调用 `memory_*` / `message_*` 等屏蔽工具 → 工具不存在（子 agent 的 tool 列表里就没有）
7. **Provider 切换**：`subagent({ prompt, provider: "doubao" })` → 日志显示子 agent 用了 doubao

## 非目标 / 明确不做

- **角色封装**（implementer / spec-reviewer / code-quality-reviewer）：走 skill 层，不进 core
- **配置化限制**：所有 limit 先 hardcode，真有需求再开；避免 schema 膨胀
- **多轮 messages 输入**：当前只支持单 prompt 字符串。父 agent 若需要上下文，应在 prompt 里自行拼接
- **自动测试套件**：按项目现状，只提供手动冒烟清单
- **streaming 返回**：父 agent 只拿最终 text；中间过程走 logger debug
