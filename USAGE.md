# OpenMantis 使用文档

OpenMantis 是一个轻量级多平台 Agent 框架，基于 Bun + Vercel AI SDK v6 构建。支持飞书、企业微信、QQ 三种通道，内置丰富的工具组和技能系统，并提供定时任务调度能力。

## 快速开始

### 安装依赖

```bash
bun install
```

### 配置

OpenMantis 使用 JSON 配置文件（`.openmantis/config.json`），可通过 Web UI 或手动编辑进行配置。

**推荐方式：Web UI**

首次启动时，Web UI 会自动引导你完成配置向导：

```bash
bun start
# 访问 http://127.0.0.1:7777
```

**手动配置**

也可以直接创建 `.openmantis/config.json`：

```json
{
  "defaultProvider": "my-openai",
  "providers": [
    {
      "name": "my-openai",
      "provider": "openai",
      "model": "gpt-4o",
      "apiKey": "sk-...",
      "baseUrl": "",
      "apiType": "chat",
      "thinking": false,
      "reasoningEffort": "medium"
    }
  ],
  "systemPrompt": "",
  "maxToolRoundtrips": 50,
  "channels": ["feishu"],
  "excludeTools": [],
  "feishu": {
    "appId": "cli_xxx",
    "appSecret": "xxx"
  }
}
```

### 多 Provider 配置

OpenMantis 支持同时配置多个 LLM 提供商，并在不同通道或会话中使用不同的 Provider：

```json
{
  "defaultProvider": "claude",
  "providers": [
    {
      "name": "claude",
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "apiKey": "sk-ant-...",
      "thinking": true
    },
    {
      "name": "gpt",
      "provider": "openai",
      "model": "gpt-4o",
      "apiKey": "sk-...",
      "apiType": "response"
    },
    {
      "name": "doubao",
      "provider": "bytedance",
      "model": "ep-xxx",
      "apiKey": "xxx",
      "baseUrl": "https://ark.cn-beijing.volces.com/api/v3"
    }
  ]
}
```

每个 Provider 包含独立的配置：

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `name` | 唯一标识符，用于引用 | （必填） |
| `provider` | 提供商类型 | `"openai"` |
| `model` | 模型 ID | `"gpt-4o"` |
| `apiKey` | API Key | — |
| `baseUrl` | 自定义 API 端点 | 提供商默认值 |
| `apiType` | OpenAI API 类型（仅 openai 有效） | `"chat"` |
| `thinking` | 深度思考模式 | `false` |
| `reasoningEffort` | OpenAI 推理强度 | `"medium"` |
| `temperature` | 温度 | — |
| `topP` | Top P | — |

#### Provider 绑定优先级

Provider 按以下优先级解析：

```
Route 级别 > Channel Binding > Channel 配置 > 全局默认
```

- **Route 级别**：通过 `/model` 命令在当前会话中切换
- **Channel Binding**：通过 `/model <name> --default` 持久化到通道
- **Channel 配置**：在通道配置中指定 `provider` 字段
- **全局默认**：`defaultProvider` 指定的 Provider

#### 通道绑定 Provider

每个通道可以可选地绑定一个 Provider：

```json
{
  "feishu": {
    "appId": "cli_xxx",
    "appSecret": "xxx",
    "provider": "claude"
  },
  "wecom": {
    "botId": "BOT_ID",
    "secret": "SECRET",
    "provider": "gpt"
  }
}
```

### 启动

```bash
# 生产模式
bun start

# 守护进程模式
bun run start:daemon

# 停止守护进程
bun run stop

# 开发模式（文件变更自动重启，自动开启 debug 日志）
bun run dev
```

## 核心概念

### Route（会话）

Route 是对话会话单元，包含独立的消息历史和配置。

- 每个 Route 有唯一 ID
- 持久化存储在 `.openmantis/routes/` 目录下
- 支持多通道同时访问同一 Route
- 可随时在多个 Route 间切换，恢复历史对话
- 每个 Route 可独立指定 Provider 和 Model

### 通道

OpenMantis 支持三种通信通道：

| 通道 | 说明 | Route ID 格式 |
|------|------|---------------|
| **Feishu** | 飞书/Lark WebSocket 长连接，支持流式卡片、交互按钮、附件下载 | `feishu-{chatId}` |
| **WeCom** | 企业微信 WebSocket 长连接，支持流式回复、附件下载 | `wecom-{chatId}` |
| **QQ** | QQ 机器人通道 | `qq-{channelId}` |

### 提供商

支持六种 LLM 提供商：

| 提供商 | 说明 | 默认端点 |
|--------|------|----------|
| `openai` | OpenAI（支持 chat/completion/response 三种 API 类型） | OpenAI 官方 |
| `anthropic` | Anthropic Claude | Anthropic 官方 |
| `bytedance` | 字节跳动/豆包（Ark） | `ark.cn-beijing.volces.com` |
| `v-api` | V-API | `api.vveai.com` |
| `xiaomi-mimo` | 小米 MiMo | `api.xiaomimimo.com` |


所有非 OpenAI/Anthropic 提供商通过 `@ai-sdk/openai-compatible` 适配器接入，可通过 `baseUrl` 覆盖端点。

### 深度思考

通过 `/think` 命令或在 Provider 配置中设置 `thinking: true` 启用 Agent 深度推理：

- **OpenAI**：使用 `reasoningEffort` 参数（low/medium/high）
- **Anthropic**：使用 adaptive thinking
- **其他提供商**：使用 `<think>` 标签提取推理过程

每个 Provider 可以独立配置是否开启 thinking。

## 工具组

通过 `excludeTools` 配置项排除不需要的工具组（默认全部启用）。

| 工具组 | 包含工具 | 说明 |
|--------|----------|------|
| `bash` | Shell 执行 | 执行命令，返回 stdout/stderr。跨平台（Unix: bash, Windows: PowerShell） |
| `search` | file_search, content_search | 文件搜索和内容搜索 |
| `skills` | 技能工具 | 加载内置和自定义技能（见下方技能章节） |
| `tavily` | tavilySearch, tavilyExtract, tavilyCrawl, tavilyMap | 网页搜索与内容提取 |
| `exa` | exaWebSearch | 语义搜索引擎 |
| `time` | currentTime | 获取当前日期时间（支持任意时区） |
| `tapd` | tapd_lookup, tapd_schema, tapd_execute | TAPD 项目管理（通过 MCP 远程服务） |
| `schedule` | create_schedule, list_schedules, cancel_schedule, edit_schedule | 定时任务管理 |
| `rss` | rssFetch, rssDiscover | RSS/Atom 订阅源解析与发现 |

飞书通道会自动注入飞书专属工具（如 `feishu_get_chat_members` 等），企业微信和 QQ 通道同理。

## 定时任务

启用 `schedule` 工具组后，Agent 可通过自然语言创建和管理定时任务。

### 三种调度模式

| 模式 | 说明 | 示例 |
|------|------|------|
| `every` | 固定间隔执行 | 每 30 分钟执行一次 |
| `cron` | Cron 表达式（5 字段） | `0 9 * * 1-5` 工作日每天 9 点 |
| `at` | 一次性定时执行 | `2026-04-02T07:00:00` |

默认时区：`Asia/Shanghai`。任务通过 Gateway 完整 Agent 管道执行，结果可投递到指定通道。

### 任务管理命令

```
/schedule list              # 列出所有定时任务
/schedule delete <id>       # 删除任务
/schedule pause <id>        # 暂停任务
/schedule resume <id>       # 恢复任务
```

任务也可通过 Agent 工具以自然语言创建和编辑，支持修改调度参数、提示词、目标通道、最大执行次数等。

### 任务状态

- `active` — 正常运行
- `paused` — 已暂停
- `completed` — 已完成（达到最大执行次数或一次性任务执行完毕）

已完成的任务可通过编辑工具重新激活。

## 内置技能

启用 `skills` 工具组后可用。技能通过 `experimental_createSkillTool` 加载。

| 技能 | 说明 | 依赖 |
|------|------|------|
| weather | 天气查询（wttr.in / Open-Meteo） | 无 |
| find-skills | 发现可用技能 | 无 |
| docx | 创建/编辑 Word 文档 | 无 |
| xlsx | 创建/编辑 Excel 表格 | 无 |
| volcengine-image-generate | 火山引擎图片生成 | 需配置 `volcengine.arkApiKey` |
| daily-ai-news | AI 资讯聚合 | 需启用 tavily 工具 |
| skill-creator | 创建和测试新技能 | 无 |

自定义技能放在 `skills.directory` 配置的目录下（默认 `./skills`），会自动加载。

## 命令参考

所有命令以 `/` 开头。

### 会话管理

| 命令 | 说明 |
|------|------|
| `/new` | 创建新 Route |
| `/resume <id\|alias>` | 恢复之前的 Route |
| `/list` | 列出所有 Route（飞书通道显示交互按钮） |
| `/delete [id\|alias]` | 删除 Route，不传参删除当前 Route |
| `/clear` | 清空当前 Route 消息历史 |
| `/history` | 显示当前 Route 消息历史 |

### 配置与控制

| 命令 | 说明 |
|------|------|
| `/model` | 显示当前 Provider 和 Model |
| `/model <provider>` | 切换到指定 Provider 的默认 Model（当前会话） |
| `/model <provider>/<model>` | 切换到指定 Provider 的指定 Model（当前会话） |
| `/model <provider> --default` | 切换 Provider 并持久化为通道默认值 |
| `/think [on\|off]` | 切换深度思考模式 |
| `/schedule <子命令>` | 管理定时任务（list / delete / pause / resume） |
| `/help` | 列出所有可用命令 |

## Web UI

OpenMantis 内置 Web 配置面板，默认地址 `http://127.0.0.1:7777`。

- **配置向导**：首次启动自动引导完成 Provider、通道、工具、高级设置配置
- **仪表盘**：分区管理所有配置项，支持分区保存和重置
- **多 Provider 管理**：添加、编辑、删除 Provider，设置默认 Provider，测试连接
- **通道 Provider 绑定**：每个通道可选择使用特定 Provider

远程访问时会自动生成 Auth Token，可通过 `web.authToken` 自定义。

## 使用示例

### 基本对话

```
> 你好，介绍一下你自己
OpenMantis: 我是 OpenMantis，一个多功能的聊天助手...
```

### 搜索与研究

```
> 帮我调研一下 Bun 的最新特性
（Agent 使用 tavily 工具搜索网页并总结）
```

### 编程辅助

```
> 帮我写一个快速排序并测试
（Agent 使用 bash 工具执行命令、读写文件）
```

### 切换 Provider

```
> /model
Provider: claude (anthropic)
Model: claude-sonnet-4-20250514

> /model gpt
Switched to gpt (openai) / gpt-4o

> /model doubao/ep-xxx-new --default
Switched to doubao (bytedance) / ep-xxx-new (set as channel default)
```

### 定时任务

```
> 帮我创建一个定时任务，每天早上 9 点推送 AI 新闻摘要
（Agent 使用 schedule 工具创建 cron 任务）

> /schedule list
ID       | 描述              | 模式  | 状态   | 下次执行
abc123   | 每日AI新闻推送     | cron  | active | 2026-04-02 09:00
```

### 会话切换

```
> /list
Routes:
  abc123 (0401-1030-quicksort) *  (5 msgs, 4/1/2026)
  def456 (0401-1045-bun-research)  (3 msgs, 4/1/2026)

> /resume 0401-1045-bun-research
（恢复之前的对话）
```

## 开发

```bash
bun run dev          # 开发模式（watch + debug 日志）
bun run dev:clear    # 清除日志后启动开发模式
bun run typecheck    # TypeScript 类型检查
bun run check        # Biome 代码检查与格式化
bun run build:web    # 构建 Web 前端
bun run dev:web      # Web 前端 watch 模式
bun run log:tail     # 实时查看日志
bun run log:clear    # 清除日志文件
```

### 调试环境变量

| 变量 | 说明 |
|------|------|
| `LOG_LEVEL=debug` | 开启详细日志 |
| `DEBUG_PROMPT=true` | 打印系统提示词 |
| `DEBUG_TOOLS=true` | 打印工具详情 |
| `DRY_RUN=true` | 模拟 LLM，不调用 API |

## 数据存储

| 路径 | 内容 |
|------|------|
| `.openmantis/config.json` | 配置文件 |
| `.openmantis/routes/{id}.json` | Route 会话数据（消息历史、Provider、Model） |
| `.openmantis/schedules/{id}.json` | 定时任务数据 |
| `.openmantis/channel-bindings.json` | 通道与 Route 的绑定关系、通道默认 Provider |
| `.openmantis/openmantis.log` | 运行日志 |

删除 `.openmantis/` 目录即可清除所有持久化数据。
