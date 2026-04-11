# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenMantis is a multi-platform agentic chat framework that connects LLM providers (OpenAI, Anthropic, Bytedance/Doubao, Xiaomi MiMo, any OpenAI-compatible endpoint) to communication channels (Feishu/Lark, WeCom, QQ) with composable tools, scheduling, and browser automation.

Built on **Bun** runtime and **Vercel AI SDK v6**.

## Commands

**Production (CLI — `bin/openmantis`):**

```bash
openmantis start       # Start daemon
openmantis stop        # Stop
openmantis restart     # Restart
openmantis status      # Show running status
openmantis log         # Tail log file
```

**Development:**

```bash
bun install              # Install dependencies
bun run dev              # Dev mode with watch + debug logging
bun run dev:full         # Dev with backend + Vite dev server
bun run dev:web          # Web frontend watch mode (Vite)
bun run typecheck        # TypeScript type-check (tsc --noEmit)
bun run check            # Biome lint + format (with --unsafe)
bun run build:web        # Build web frontend
```

Debug environment variables: `LOG_LEVEL=debug`, `DEBUG_PROMPT=true`.

## Code Style

- **Biome** for linting and formatting: tabs, double quotes, line width 100, LF line endings
- Run `bun run check` and `bun run typecheck` before committing
- `noNonNullAssertion` and `noExplicitAny` are intentionally disabled

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

- `src/index.ts` — Main entry point
- `packages/core/src/agent/providers.ts` — LLM provider instantiation
- `packages/core/src/agent/factory.ts` — Tool resolution and agent creation
- `packages/core/src/tools/` — All tool implementations (bash, file, search, tavily, schedule, memory, skills, etc.)
- `packages/common/src/config/schema.ts` — Zod config validation schema
- `skills/builtin/` — Built-in agent skills (docx, xlsx, weather, image-gen, browser, frontend-design)
- `.openmantis/` — Runtime data (config.json, routes, schedules, logs, uploads)

### Provider Priority Resolution

Route-level override → Channel binding → Channel config → Global default

### Tool System

Tools are organized by group name and can be excluded via `excludeTools` config. Channel-specific tools are auto-injected based on the active channel. Skills (from `skills/builtin/` or custom) are loaded dynamically and exposed as tools.
