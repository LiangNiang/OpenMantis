# Contributing to OpenMantis

Thank you for your interest in contributing to OpenMantis!

## Getting Started

1. Fork and clone the repository
2. Install dependencies: `bun install`
3. Copy the example config or use the web setup wizard: `bun run dev`
4. Run in dev mode: `bun run dev`

## Development

```bash
bun run dev          # Dev mode with watch + debug logging
bun run dev:full     # Dev mode with both backend and Vite dev server
bun run typecheck    # Type-check
bun run check        # Lint + format (Biome)
```

## Code Style

- **Biome** for linting and formatting: tabs, double quotes, line width 100
- Run `bun run check` before committing
- Run `bun run typecheck` to verify type safety

## Project Structure

This is a Bun monorepo with workspaces under `packages/`:

- `core` - Agent, gateway, tools, config, commands
- `common` - Shared config schemas, logger, utilities
- `channel-feishu` / `channel-wecom` / `channel-qq` - Channel adapters
- `scheduler` - Task scheduling service
- `tts` - Text-to-speech
- `web` - React frontend (config dashboard)
- `web-server` - Hono API server

## Submitting Changes

1. Create a feature branch from `master`
2. Make your changes with clear commit messages
3. Ensure `bun run typecheck` and `bun run check` pass
4. Submit a pull request with a description of the changes

## Reporting Issues

- Use GitHub Issues to report bugs or suggest features
- Include steps to reproduce for bug reports
- Include your Bun version and OS

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
