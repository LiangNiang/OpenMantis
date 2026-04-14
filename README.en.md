# OpenMantis

[中文](README.md) | [English](README.en.md)

**A minimal multi-platform agentic chat framework built with Bun + Vercel AI SDK.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?style=flat-square&logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![AI SDK](https://img.shields.io/badge/AI_SDK-v6-black?style=flat-square&logo=vercel&logoColor=white)](https://ai-sdk.dev)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/LiangNiang/OpenMantis/pulls)

[![Feishu](https://img.shields.io/badge/飞书-Feishu-4f46e5?style=flat-square&logo=bytedance&logoColor=white)](packages/channel-feishu)
[![WeCom](https://img.shields.io/badge/企业微信-WeCom-07c160?style=flat-square&logo=wechat&logoColor=white)](packages/channel-wecom)
[![QQ](https://img.shields.io/badge/QQ-12b7f5?style=flat-square&logo=qq&logoColor=white)](packages/channel-qq)

Connect multiple LLM providers to multiple communication channels with composable tools, scheduling, browser automation, and more — all from a single deployment.

---

## Features

- **Multi-LLM-Provider** — OpenAI, Anthropic, Bytedance/Doubao, Xiaomi MiMo, and any OpenAI-compatible endpoint. Switch LLM providers per channel or per message route.
- **Multi-Channel** — Feishu/Lark, WeCom, QQ. Each channel gets streaming responses and attachment handling. Feishu additionally supports interactive card UI and multiple bot apps per channel.
- **Composable Tools** — Bash, file I/O, web search (Tavily, Exa), RSS, TTS, memory, scheduling, and more. Enable or disable tool groups via config.
- **Skills System** — Built-in skills (weather, DOCX/XLSX generation, browser automation, image generation) plus user-defined custom skills.
- **Task Scheduler** — Fixed interval, cron expression, or one-time scheduled tasks that execute through the full agent pipeline.
- **Browser Automation** — Drive a real browser via [agent-browser](https://github.com/vercel-labs/agent-browser) with isolated per-session profiles or CDP mode for reusing your local Chrome.
- **Web Dashboard** — First-run setup wizard and config management UI with i18n (English/Chinese) and provider connection testing.
- **Extended Thinking** — Reasoning effort control for OpenAI and adaptive thinking for Anthropic models.
- **Long-Term Memory** — Two-tier memory architecture: core memory for user preferences and key facts, archive memory for chronological decisions and insights. Multi-dimensional recall by keyword, date, and tag, plus automatic memory extraction after conversations.
- **Session Management** — Persistent message routes with message history and channel-to-message-route bindings.

## Prerequisites

- An API key for at least one supported LLM provider
- Channel credentials (Feishu app, WeCom bot, or QQ bot) for the platforms you want to connect
- [Bun](https://bun.sh) is only required when running from source; pre-built binaries need no runtime

## Getting Started

### Option 1: Pre-built Binary (Recommended)

Download the binary for your platform from [Releases](https://github.com/LiangNiang/OpenMantis/releases) — no Bun or dependencies needed:

```bash
chmod +x openmantis-linux-x64
./openmantis-linux-x64 init      # Extract built-in skills
./openmantis-linux-x64 start     # Start daemon
```

> [!IMPORTANT]
> macOS users: binaries downloaded from GitHub Releases get tagged with the `com.apple.quarantine` attribute and may be blocked by Gatekeeper on first run ("cannot be opened because the developer cannot be verified"). Remove the quarantine attribute:
>
> ```bash
> xattr -d com.apple.quarantine ./openmantis-darwin-arm64
> chmod +x ./openmantis-darwin-arm64
> ```

> [!IMPORTANT]
> Windows users: do not double-click the `.exe` — it is a CLI program, and double-clicking only flashes a black console window that disappears. Open **PowerShell** or **CMD**, `cd` to the binary's directory, then run:
>
> ```powershell
> .\openmantis-windows-x64.exe init      # Extract built-in skills
> .\openmantis-windows-x64.exe start     # Start daemon
> ```

### Option 2: From Source

```bash
git clone https://github.com/LiangNiang/OpenMantis.git
cd OpenMantis
bun install
bun run dev                      # Dev mode (foreground)
```

### First-Time Setup

On first start, OpenMantis automatically launches a **setup wizard** at `http://127.0.0.1:7777` — follow the steps to configure your provider, channels, and tools. Restart after setup to apply changes.

Runtime data is stored in `~/.openmantis/` (customizable via `OPENMANTIS_DATA_DIR` environment variable).

### CLI Commands

```bash
openmantis start       # Start daemon
openmantis stop        # Stop
openmantis restart     # Restart
openmantis status      # Show running status
openmantis log         # Tail log file
openmantis run         # Run in foreground (for Docker or debugging)
openmantis init        # Extract built-in skills (--force to overwrite)
```

## Usage Examples

| | Description |
|---|---|
| ![Feishu Tools Call](examples/imgs/01.gif) | Feishu channel showing tools invocation with auto-collapse on completion |
| ![Scheduled Tasks](examples/imgs/02.gif) | Scheduled tasks |
| ![Memory](examples/imgs/03.gif) | Memory saving and recall |

## Architecture

```
Channel (Feishu / WeCom / QQ)
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

Messages flow from a channel adapter through the **Gateway**, which manages sessions (message routes) and creates agents. The **AgentFactory** resolves the appropriate LLM provider, tools, and system prompt, then delegates to a **ToolLoopAgent** for streaming execution.

## Project Structure

```
OpenMantis/
├── src/
│   ├── cli.ts                    # CLI entry (start/stop/restart/run/init)
│   ├── index.ts                  # Main application logic
│   ├── daemon.ts                 # Daemon management
│   └── init.ts                   # Built-in skills extraction
├── packages/
│   ├── common/                   # Shared types, logger, config schema
│   ├── core/                     # Agent, gateway, commands, tools
│   ├── scheduler/                # Cron/interval/one-time task scheduler
│   ├── tts/                      # Text-to-speech providers
│   ├── channel-feishu/           # Feishu/Lark adapter
│   ├── channel-wecom/            # WeCom adapter
│   ├── channel-qq/               # QQ adapter
│   ├── web/                      # React 19 + Vite + Tailwind v4 dashboard
│   └── web-server/               # Hono API server
├── skills/builtin/               # Built-in agent skills
├── scripts/build.ts              # Binary build script
└── ~/.openmantis/                # Runtime data (config, message routes, skills, logs)
```

## LLM Providers

| LLM Provider | Package | Notes |
|----------|---------|-------|
| OpenAI | `@ai-sdk/openai` | GPT-4o, o-series, etc. |
| Anthropic | `@ai-sdk/anthropic` | Claude with adaptive thinking |
| Bytedance/Doubao | `@ai-sdk/openai-compatible` | Via Volcengine Ark |
| Xiaomi MiMo | `@ai-sdk/openai-compatible` | Optional web search plugin |
| OpenAI Compatible | `@ai-sdk/openai-compatible` | Any OpenAI-compatible endpoint |

LLM Provider priority: Message route override > Channel binding > Channel config > Global default.

## Tools

Tools are organized into groups and can be toggled via the `excludeTools` config array:

| Group | Tools | Description |
|-------|-------|-------------|
| `bash` | `bash`, `bash_write`, `bash_wait`, `bash_kill` | PTY-based shell execution with timeout, interactive input, and session management |
| `file` | `file_read`, `file_write`, `file_edit` | Read (with offset/limit), create/overwrite, and partial edit (string replace or line range) |
| `search` | `file_search`, `content_search` | Glob pattern matching + regex content search (ripgrep backend) |
| `skills` | `skill_*` | Dynamically generated tool per loaded skill |
| `tavily` | `tavilySearch`, `tavilyExtract`, `tavilyCrawl`, `tavilyMap` | Web search, URL content extraction, site crawling, and sitemap generation |
| `exa` | `exaWebSearch` | Semantic web search via Exa neural search engine |
| `schedule` | `create_schedule`, `list_schedules`, `get_schedule`, `cancel_schedule`, `edit_schedule` | Create/list/get/cancel/edit scheduled tasks (every/cron/at) |
| `rss` | `rssFetch`, `rssDiscover` | Parse RSS/Atom feeds and discover feed URLs from websites |
| `whisper` | `audio_transcribe` | Transcribe audio/video files to text with SRT subtitles and timestamps |
| `tts` | `tts_speak` | Text-to-speech synthesis via Xiaomi TTS with style/expression support |
| `memory` | `save_memory`, `recall_memory`, `load_route_context` | Long-term memory (core/archive), keyword/date/tag recall, and past session loading |
| `message` | `send_message` | Send messages to specified channels (always injected when gateway context available) |

Channel-specific tools (Feishu file uploads, doc creation, etc.) are injected automatically based on the active channel.

## Skills

Built-in skills are extracted to `~/.openmantis/skills/builtin/` on first run via `openmantis init`. Custom skills go in `~/.openmantis/skills/custom/`.

| Skill | Description |
|-------|-------------|
| `docx` | Create, read, edit, and manipulate Word documents (.docx) |
| `xlsx` | Work with spreadsheet files (.xlsx, .xlsm, .csv, .tsv) |
| `weather` | Get current weather and forecasts via wttr.in or Open-Meteo |
| `image-generate` | Generate images using Doubao Seedream models from text or reference images |
| `agent-browser` | Browser automation — navigate, fill forms, click, screenshot, extract data |
| `frontend-design` | Generate production-grade frontend interfaces (React components, dashboards, etc.) |
| `skill-manager` | Manage the complete lifecycle of OpenMantis skills (create, discover, install, audit) |

## Slash Commands

Users interact with the agent via `/` commands in chat:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/new` | Start a new message route |
| `/clear` | Clear current message route messages |
| `/stop` | Force-stop the in-flight conversation |
| `/delete [id]` | Delete a message route |
| `/list` | List all message routes |
| `/history` | Show current message route messages |
| `/resume <id>` | Resume a previous message route |
| `/channel` | Show current channel type and ID |
| `/schedule <list\|delete\|pause\|resume>` | Manage scheduled tasks |
| `/voice [on\|off]` | Toggle TTS voice mode (Feishu/WeCom only) |
| `/remember <content>` | Save something to core memory |
| `/forget <keyword>` | Remove matching entries from core memory |
| `/memories` | Show current core memories |
| `/bot-open-id` | Show bot open_id (Feishu only) |
| `/open-id` | Show your Feishu open_id |

## Browser Automation

OpenMantis can drive a real browser via [agent-browser](https://github.com/vercel-labs/agent-browser).

```bash
npm install -g agent-browser
agent-browser install   # downloads Chrome
```

Enable in config:

```json
{
  "browser": {
    "enabled": true
  }
}
```

Each conversation gets an isolated browser profile. For reusing your local Chrome session, enable **CDP mode** instead:

```bash
google-chrome --remote-debugging-port=9222
```

> [!IMPORTANT]
> In CDP mode, conversations share your real browser (cookies, sessions, tabs). Avoid pointing the agent at sensitive accounts.

## Scheduler

Three scheduling modes for automated tasks:

- **`every`** — Fixed interval (e.g., every 30 minutes)
- **`cron`** — 5-field cron expression with timezone support (default: `Asia/Shanghai`)
- **`at`** — One-time execution at a specific datetime

Tasks execute through the full agent pipeline and results are delivered to the originating channel.

## Roadmap

### Phase 1

- [ ] **Deep Feishu Integration** — Expand native Feishu capabilities (approvals, calendar, email, docs, etc.)
- [ ] **Multi-Agent Orchestration** — Support Multi-Agent and Sub-Agent collaboration for complex task decomposition and parallel execution
- [ ] **Memory System Redesign** — Rearchitect storage and retrieval for better accuracy and scalability
- [ ] **Telegram Channel** — Add Telegram Bot adapter

> [PRs welcome!](https://github.com/LiangNiang/OpenMantis/pulls)

## Debug Flags

```bash
LOG_LEVEL=debug      # Verbose logging
DEBUG_PROMPT=true    # Print system prompt
```

## Scripts Reference

**Development:**

```bash
bun run dev            # Dev mode with watch + debug logging
bun run dev:full       # Dev mode with backend + Vite dev server
bun run typecheck      # Type-check with tsc
bun run check          # Biome lint + format
bun run build:web      # Build web frontend
```

**Build Binaries:**

```bash
bun run build:bin      # Build binary for current platform
bun run build:bin:all  # Build all platforms (Linux/macOS/Windows, x64/ARM64)
```

> **Note:** In `dev:full` mode, Vite automatically picks an available port for the frontend dev server. Access the URL printed by Vite (e.g., `http://localhost:5173`). API requests are automatically proxied to the backend (default `localhost:7777`).

## Contact

- **Email**: liangniangbaby@gmail.com
- **GitHub**: [@LiangNiang](https://github.com/LiangNiang)
