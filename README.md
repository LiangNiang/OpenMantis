# OpenMantis

[中文](README.md) | [English](README.en.md)

**基于 Bun + Vercel AI SDK 构建的轻量级多平台 Agent 聊天框架。**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?style=flat-square&logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![AI SDK](https://img.shields.io/badge/AI_SDK-v6-black?style=flat-square&logo=vercel&logoColor=white)](https://ai-sdk.dev)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/LiangNiang/OpenMantis/pulls)

[![Feishu](https://img.shields.io/badge/飞书-Feishu-4f46e5?style=flat-square&logo=bytedance&logoColor=white)](packages/channel-feishu)
[![WeCom](https://img.shields.io/badge/企业微信-WeCom-07c160?style=flat-square&logo=wechat&logoColor=white)](packages/channel-wecom)
[![QQ](https://img.shields.io/badge/QQ_(WIP)-12b7f5?style=flat-square&logo=tencentqq&logoColor=white)](packages/channel-qq)

将多个 LLM 供应商连接到多个通讯平台，配合可组合的工具、定时任务、浏览器自动化、记忆系统、定时任务等能力 —— 一次部署，全部搞定。

---

## 特性

- **多 LLM 供应商** — OpenAI、Anthropic、字节跳动/豆包、小米 MiMo，以及任意 OpenAI 兼容端点。支持按通道或按会话切换 LLM 供应商。
- **多平台** — 飞书/Lark、企业微信、QQ。每个平台均支持流式响应和附件处理，飞书额外支持交互式卡片 UI 和单渠道接入多个飞书应用。
- **可组合工具** — Bash、文件读写、网页搜索（Tavily、Exa）、RSS、TTS、记忆、定时任务等。通过配置启用或禁用工具组。
- **技能系统** — 内置技能（天气、DOCX/XLSX 生成、浏览器自动化、图片生成）以及用户自定义技能。
- **定时任务** — 固定间隔、Cron 表达式或一次性定时任务，通过完整的 Agent 管线执行。
- **浏览器自动化** — 通过 [agent-browser](https://github.com/vercel-labs/agent-browser) 驱动真实浏览器，支持每会话隔离的浏览器配置文件，或 CDP 模式复用本地 Chrome。
- **Web 管理面板** — 首次运行自动启动配置向导，支持中英文和供应商连接测试。
- **深度思考** — OpenAI 推理强度控制，Anthropic 自适应思考。
- **长期记忆** — 双层记忆架构：核心记忆保存用户偏好和关键事实，归档记忆按时间线记录决策与洞察。支持关键词、日期、标签多维检索，以及对话结束后自动提取记忆。
- **会话管理** — 持久化消息路由，包含消息历史和通道-消息路由绑定。

## 前置要求

- [Bun](https://bun.sh)
- 至少一个 LLM 供应商的 API Key
- 通道凭证（飞书应用、企业微信机器人或 QQ 机器人）

## 快速开始

### 1. 安装依赖

```bash
git clone https://github.com/LiangNiang/OpenMantis.git
cd OpenMantis
bun install
```

### 2. 运行

```bash
./bin/openmantis start
```

首次启动时，OpenMantis 会自动在 `http://127.0.0.1:7777` 打开**配置向导**，按步骤配置供应商、通道和工具即可。配置完成后重启生效。

```bash
./bin/openmantis restart   # 重启
./bin/openmantis stop      # 停止
./bin/openmantis status    # 查看运行状态
./bin/openmantis log       # 实时查看日志
```

> 也可以通过 symlink 全局使用：`ln -s /path/to/OpenMantis/bin/openmantis /usr/local/bin/openmantis`

## 使用示例

| | 说明 |
|---|---|
| ![飞书渠道 Tools 调用](examples/imgs/01.gif) | 飞书渠道展示 Tools 调用，结束后自动折叠 |
| ![定时任务](examples/imgs/02.gif) | 定时任务 |
| ![记忆](examples/imgs/03.gif) | 记忆存储与记忆召回 |

## 架构

```
通道 (飞书 / 企业微信 / QQ)
        │
        ▼
    Gateway ──► AgentFactory ──► ToolLoopAgent (Vercel AI SDK)
        │                              │
  RouteStore +                   resolveTools()
  ChannelBindings                      │
        │                        ┌─────┴─────┐
        ▼                        │  Tools     │
    Response ◄───────────────────│  Skills    │
                                 │  Memory    │
                                 └────────────┘
```

消息从通道适配器流入 **Gateway**，由其管理会话（消息路由）并创建 Agent。**AgentFactory** 解析对应的 LLM 供应商、工具和系统提示词，然后委托 **ToolLoopAgent** 进行流式执行。

## 项目结构

```
OpenMantis/
├── src/index.ts                  # 入口文件
├── packages/
│   ├── common/                   # 共享类型、日志、配置 Schema
│   ├── core/                     # Agent、Gateway、命令、工具
│   ├── scheduler/                # Cron/间隔/一次性定时任务
│   ├── tts/                      # 文字转语音供应商
│   ├── channel-feishu/           # 飞书/Lark 适配器
│   ├── channel-wecom/            # 企业微信适配器
│   ├── channel-qq/               # QQ 适配器
│   ├── web/                      # React 19 + Vite + Tailwind v4 管理面板
│   └── web-server/               # Hono API 服务器
├── skills/builtin/               # 内置 Agent 技能
└── .openmantis/                  # 运行时数据（消息路由、配置、日志）
```

## LLM 供应商

| LLM 供应商 | 包 | 说明 |
|--------|-----|------|
| OpenAI | `@ai-sdk/openai` | GPT-4o、o 系列等 |
| Anthropic | `@ai-sdk/anthropic` | Claude，支持自适应思考 |
| 字节跳动/豆包 | `@ai-sdk/openai-compatible` | 通过火山引擎 Ark |
| 小米 MiMo | `@ai-sdk/openai-compatible` | 可选网页搜索插件 |
| OpenAI 兼容 | `@ai-sdk/openai-compatible` | 任意 OpenAI 兼容端点 |

LLM 供应商优先级：消息路由覆盖 > 通道绑定 > 通道配置 > 全局默认。

## 工具

工具按组管理，通过 `excludeTools` 配置数组进行开关：

| 工具组 | 工具 | 说明 |
|--------|------|------|
| `bash` | `bash`, `bash_write`, `bash_wait`, `bash_kill` | 基于 PTY 的 Shell 执行，支持超时、交互输入和会话管理 |
| `file` | `file_read`, `file_write`, `file_edit` | 文件读取（支持偏移/限制）、创建/覆盖、部分编辑（字符串替换或行范围） |
| `search` | `file_search`, `content_search` | Glob 模式匹配 + 正则内容搜索（ripgrep 后端） |
| `skills` | `skill_*` | 每个加载的技能动态生成对应工具 |
| `tavily` | `tavilySearch`, `tavilyExtract`, `tavilyCrawl`, `tavilyMap` | 网页搜索、URL 内容提取、站点爬取和站点地图生成 |
| `exa` | `exaWebSearch` | 基于 Exa 神经搜索引擎的语义网页搜索 |
| `schedule` | `create_schedule`, `list_schedules`, `get_schedule`, `cancel_schedule`, `edit_schedule` | 创建/列出/查看/取消/编辑定时任务（every/cron/at） |
| `rss` | `rssFetch`, `rssDiscover` | 解析 RSS/Atom 订阅源，从网站发现订阅源 URL |
| `whisper` | `audio_transcribe` | 音频/视频文件转文字，支持 SRT 字幕和时间戳 |
| `tts` | `tts_speak` | 基于小米 TTS 的文字转语音合成，支持风格和表情控制 |
| `memory` | `save_memory`, `recall_memory`, `load_route_context` | 长期记忆（核心/归档）、关键词/日期/标签检索、历史会话加载 |
| `message` | `send_message` | 向指定通道发送消息（网关上下文可用时自动注入） |

通道特定工具（飞书文件上传、文档创建等）会根据当前通道自动注入。

## 技能

内置技能从 `skills/builtin/` 加载，用户也可通过 `config.skills.directory` 添加自定义技能。

| 技能 | 说明 |
|------|------|
| `docx` | 创建、读取、编辑和操作 Word 文档（.docx） |
| `xlsx` | 处理电子表格文件（.xlsx、.xlsm、.csv、.tsv） |
| `weather` | 通过 wttr.in 或 Open-Meteo 获取天气和预报 |
| `image-generate` | 使用豆包 Seedream 模型从文本或参考图生成图片 |
| `agent-browser` | 浏览器自动化 —— 导航、填表、点击、截图、数据提取 |
| `frontend-design` | 生成生产级前端界面（React 组件、仪表盘等） |
| `skill-manager` | 管理 OpenMantis 技能的完整生命周期（创建、发现、安装、审计） |

## 斜杠命令

用户通过聊天中的 `/` 命令与 Agent 交互：

| 命令 | 说明 |
|------|------|
| `/help` | 显示可用命令 |
| `/new` | 开始新消息路由 |
| `/clear` | 清除当前消息路由的消息 |
| `/stop` | 强制停止进行中的对话 |
| `/delete [id]` | 删除消息路由 |
| `/list` | 列出所有消息路由 |
| `/history` | 查看当前消息路由的消息 |
| `/resume <id>` | 恢复之前的消息路由 |
| `/channel` | 显示当前通道类型和 ID |
| `/schedule <list\|delete\|pause\|resume>` | 管理定时任务 |
| `/voice [on\|off]` | 切换 TTS 语音模式（仅飞书/企业微信） |
| `/remember <content>` | 保存内容到核心记忆 |
| `/forget <keyword>` | 删除匹配的核心记忆 |
| `/memories` | 显示当前核心记忆 |
| `/bot-open-id` | 显示机器人 open_id（仅飞书） |
| `/open-id` | 显示你的飞书 open_id |

## 浏览器自动化

OpenMantis 可通过 [agent-browser](https://github.com/vercel-labs/agent-browser) 驱动真实浏览器。

```bash
npm install -g agent-browser
agent-browser install   # 下载 Chrome
```

在配置中启用：

```json
{
  "browser": {
    "enabled": true
  }
}
```

每个对话会获得独立的浏览器配置文件。如需复用本地 Chrome 会话，请改用 **CDP 模式**：

```bash
google-chrome --remote-debugging-port=9222
```

> [!IMPORTANT]
> CDP 模式下，所有对话共享你的真实浏览器（Cookie、会话、标签页）。请勿将 Agent 指向敏感账户。

## 定时任务

三种定时任务模式：

- **`every`** — 固定间隔（如每 30 分钟）
- **`cron`** — 5 字段 Cron 表达式，支持时区（默认：`Asia/Shanghai`）
- **`at`** — 一次性定时执行

任务通过完整的 Agent 管线执行，结果发送到创建任务的通道。

## Roadmap

### Phase 1

- [ ] **飞书深度集成** — 扩展飞书原生能力（审批流、日历、邮件、云文档等）
- [ ] **多 Agent 编排** — 支持 Multi-Agent 与 Sub-Agent 协作，实现复杂任务拆解与并行执行
- [ ] **记忆系统重构** — 重新设计存储与检索架构，提升长期记忆的准确性与可扩展性
- [ ] **Telegram 渠道** — 新增 Telegram Bot 适配器

> **Note:** QQ 渠道尚未得到很好的适配支持，欢迎提交 [PR](https://github.com/LiangNiang/OpenMantis/pulls) 帮助完善！

## 调试参数

```bash
LOG_LEVEL=debug      # 详细日志
DEBUG_PROMPT=true    # 打印系统提示词
```

## 脚本参考

**生产运维（CLI）：**

```bash
openmantis start       # 启动守护进程
openmantis stop        # 停止
openmantis restart     # 重启
openmantis status      # 查看运行状态
openmantis log         # 实时查看日志
```

**开发调试：**

```bash
bun run dev            # 开发模式（监听 + 调试日志）
bun run dev:full       # 开发模式（后端 + Vite 开发服务器）
bun run typecheck      # TypeScript 类型检查
bun run check          # Biome 代码检查 + 格式化
bun run build:web      # 构建 Web 前端
```

## 联系

- **Email**: liangniangbaby@gmail.com
- **GitHub**: [@LiangNiang](https://github.com/LiangNiang)
