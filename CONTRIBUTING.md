# Contributing to OpenMantis

Thank you for your interest in contributing to OpenMantis!

## Getting Started

1. Fork and clone the repository
2. Install dependencies: `bun install`
3. Run in dev mode: `bun run dev`
4. First run will launch a setup wizard at `http://127.0.0.1:7777`

## Development

```bash
bun run dev          # Dev mode with watch + debug logging
bun run dev:full     # Dev mode with both backend and Vite dev server
bun run typecheck    # Type-check
bun run check        # Lint + format (Biome)
```

Runtime data is stored in `~/.openmantis/` (override with `OPENMANTIS_DATA_DIR`).

## Building Binaries

OpenMantis can be compiled into a single self-contained binary via `bun build --compile`:

```bash
bun run build:bin      # Build for current platform → dist/bin/
bun run build:bin:all  # Build all 6 targets (Linux/macOS/Windows, x64/ARM64)
```

The build script (`scripts/build.ts`) automatically:
1. Builds the web frontend (Vite)
2. Generates import modules for embedding web assets and builtin skills
3. Compiles everything into a single binary

## Releasing

Releases are automated via GitHub Actions. To create a release:

```bash
git tag v0.x.x
git push origin v0.x.x
```

This triggers the CI workflow (`.github/workflows/release.yml`) which builds all platform binaries and publishes them to GitHub Releases with auto-generated release notes.

## Code Style

- **Biome** for linting and formatting: tabs, double quotes, line width 100
- Run `bun run check` before committing
- Run `bun run typecheck` to verify type safety

## Commit Convention

Follow the [Angular Commit Message Convention](https://github.com/angular/angular/blob/main/CONTRIBUTING.md#-commit-message-format):

```
<type>(<scope>): <short summary>
```

**type:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

## Project Structure

This is a Bun monorepo with workspaces under `packages/`:

- `core` - Agent, gateway, tools, config, commands
- `common` - Shared config schemas, logger, utilities
- `channel-feishu` / `channel-wecom` / `channel-qq` - Channel adapters
- `scheduler` - Task scheduling service
- `tts` - Text-to-speech
- `web` - React frontend (config dashboard)
- `web-server` - Hono API server

Key files in `src/`:

- `cli.ts` - CLI entry point (start/stop/restart/run/init)
- `index.ts` - Main application logic
- `daemon.ts` - Daemon process management
- `init.ts` - Builtin skills extraction from embedded files

## Submitting Changes

1. Create a feature branch from `main`
2. Make your changes with clear commit messages
3. Ensure `bun run typecheck` and `bun run check` pass
4. Submit a pull request with a description of the changes

## Reporting Issues

- Use GitHub Issues to report bugs or suggest features
- Include steps to reproduce for bug reports
- Include your Bun version and OS

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
