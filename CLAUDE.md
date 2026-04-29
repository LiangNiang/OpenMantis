# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenMantis is a multi-platform agentic chat framework that connects LLM providers (OpenAI, Anthropic, Bytedance/Doubao, DeepSeek, Xiaomi MiMo, any OpenAI-compatible endpoint) to communication channels (Feishu/Lark, WeCom, QQ) with composable tools, scheduling, browser automation, long-term memory, and auto-recap of idle sessions.

Built on **Bun** runtime and **Vercel AI SDK v6**.

## Commands

**Production (compiled `openmantis` CLI):**

```bash
openmantis start       # Start daemon (forks to background)
openmantis stop        # Stop
openmantis restart     # Restart
openmantis status      # Show running status
openmantis log         # Tail log file
openmantis run         # Foreground run (for Docker / debugging)
openmantis init        # Extract built-in skills to runtime dir (--force to overwrite)
```

**Development:**

```bash
bun install              # Install dependencies
bun run dev              # Dev mode with watch + debug logging (sets OPENMANTIS_DATA_DIR=$PWD/.openmantis)
bun run dev:full         # Dev with backend + Vite dev server (access Vite URL directly, API auto-proxied)
bun run dev:web          # Web frontend watch mode (Vite, auto-selects available port)
bun run typecheck        # TypeScript type-check (tsc --noEmit)
bun run check            # Biome lint + format (with --unsafe)
bun run build:web        # Build web frontend
bun run build:bin        # Build binary for current platform (via scripts/build.ts)
bun run build:bin:all    # Build binaries for all platforms (Linux/macOS/Windows, x64/ARM64)
```

Environment variables:

- `OPENMANTIS_DATA_DIR` — Overrides the runtime directory (see below). Default: `~/.openmantis` in production, `$PWD/.openmantis` under `bun run dev`.
- `LOG_LEVEL=debug` — Verbose logging.
- `DEBUG_PROMPT=true` — Print system prompt to log.

## Runtime Inspection

运行时目录（runtime directory）存放配置、日志、路由、调度等运行期数据，由 `OPENMANTIS_DATA_DIR` 环境变量决定：

- **开发模式**（`bun run dev` 等脚本）：项目根目录下的 `.openmantis/`
- **生产模式**（编译后通过 `openmantis` CLI 启动）：用户家目录下的 `~/.openmantis/`

检查运行时数据时，根据当前上下文选择正确的目录：

- 当用户要求检查日志时，读取运行时目录下的 `openmantis.log`
- 当需要查看会话/路由状态（历史消息、绑定、recap 等）时，读取运行时目录下 `routes/` 里的 JSON 文件

## Code Style

- **Biome** for linting and formatting: tabs, double quotes, line width 100, LF line endings
- Run `bun run check` and `bun run typecheck` before committing
- `noNonNullAssertion` and `noExplicitAny` are intentionally disabled

## Git Commit Convention

使用 [Angular Commit Message Convention](https://github.com/angular/angular/blob/main/CONTRIBUTING.md#-commit-message-format)：

```
<type>(<scope>): <short summary>
```

**type:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**scope:** 可选，通常为包名或模块名（如 `core`, `feishu`, `wecom`, `scheduler`, `web`, `readme` 等）

## Architecture

Bun monorepo with workspaces under `packages/`:

### Core Flow

```
Channel (Feishu / WeCom / QQ)
    → Gateway (packages/core/src/gateway/)
    → AgentFactory (packages/core/src/agent/)
    → ToolLoopAgent (Vercel AI SDK)
    → Tools + Skills + Memory
    → Response back to channel
```

### Packages

- **`common`** — Shared types, Zod config schemas, logger (consola), file paths
- **`core`** — Gateway orchestration, agent factory, LLM provider setup, tool definitions, slash commands
- **`channel-feishu`**, **`channel-wecom`**, **`channel-qq`** — Pluggable channel adapters; each implements the channel interface and adds channel-specific tools
- **`scheduler`** — Cron/interval/one-time task scheduling (ScheduleStore + SchedulerService)
- **`tts`** — Text-to-speech provider registry (Xiaomi)
- **`web`** — React 19 + Vite + Tailwind v4 + shadcn/ui dashboard (setup wizard, settings)
- **`web-server`** — Hono API server (config, logs, status endpoints)

### Key Directories

- `src/cli.ts` — CLI entry (dispatches start/stop/restart/run/init subcommands)
- `src/index.ts` — Main application logic (invoked by `cli.ts run`)
- `src/daemon.ts` — Daemon process management (fork/pid/log redirection)
- `scripts/build.ts` — Binary packaging script (used by `build:bin` / `build:bin:all`)
- `packages/core/src/lifecycle.ts` — Boot/shutdown wiring for gateway + scheduler + web server
- `packages/core/src/gateway/` — Channel-agnostic message routing and route lifecycle (idle detection, auto-new-route)
- `packages/core/src/agent/providers.ts` — LLM provider instantiation (OpenAI / Anthropic / DeepSeek / OpenAI-compatible)
- `packages/core/src/agent/factory.ts` — Tool resolution and agent creation
- `packages/core/src/agent/prompts.ts` — System prompt assembly (injects `MEMORY.md` indices, channel context, etc.)
- `packages/core/src/commands/` — Slash command handlers (`/new`, `/clear`, `/recap`, `/voice`, `/memories`, `/schedule`, …) dispatched via `router.ts`
- `packages/core/src/recap/` — Idle-route recap generator (LLM-driven `goal/decisions/changes/todos` summary, fire-and-forget)
- `packages/core/src/tools/` — Tool group implementations (`bash`, `browser`, `exa`, `file`, `memory/`, `message`, `rss`, `schedule`, `search`, `skills`, `tavily`, `tts`, `whisper`)
- `packages/core/src/channels/` — Channel-side glue used by the gateway (separate from the per-channel adapter packages)
- `packages/common/src/config/schema.ts` — Zod config validation schema
- `packages/common/src/paths/index.ts` — Runtime path resolution (reads `OPENMANTIS_DATA_DIR`)
- `skills/builtin/` — **Source** location of built-in skills (bundled into the binary). At runtime skills live under `$OPENMANTIS_DATA_DIR/skills/builtin/` (populated by `openmantis init`); user-added skills go in `$OPENMANTIS_DATA_DIR/skills/custom/`.

### Provider Priority Resolution

Route-level override → Channel binding → Channel config → Global default

### Tool System

Tools are organized into named groups and can be turned off via `excludeTools` config. Built-in groups: `bash`, `file`, `search`, `browser`, `tavily`, `exa`, `rss`, `whisper`, `tts`, `schedule`, `memory`, `message`, `skills`. Channel-specific tools (e.g. Feishu file upload, doc creation) are auto-injected based on the active channel. Skills loaded from `$OPENMANTIS_DATA_DIR/skills/{builtin,custom}/` are exposed dynamically as `skill_*` tools.

### Auto-New-Route + Recap

When a new message arrives on a route that has been idle longer than `autoNewRoute.idleMinutes` (default 120), the gateway transparently creates a fresh route, switches the channel binding to it, and — if the old route had ≥3 messages and `autoNewRoute.recap` is on — kicks off an async LLM-generated structured recap (`goal` / `decisions` / `changes` / `todos`) appended to `oldRoute.recaps[]`. Recap is fire-and-forget; failures don't roll back the route switch. `/recap` performs the same recap synchronously for the current route. Logic lives in `packages/core/src/gateway/` (idle detection) and `packages/core/src/recap/` (summary generation).

### Memory System

Long-term memory is dual-scoped (`global` + per-channel) with four cognitive types: `semantic`, `procedural`, `episodic`, `prospective`. Each memory is a single Markdown file with frontmatter; per scope, a `MEMORY.md` index is always injected into the system prompt while individual memory files are read by the agent on demand. Conflict detection (`detectConflictV2`) uses an LLM to flag duplicates/conflicts before `save_memory` writes. Implementation: `packages/core/src/tools/memory/`.
