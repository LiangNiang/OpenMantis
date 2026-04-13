# OpenMantis Binary Distribution Design

## Goal

Package OpenMantis as a single self-contained binary using `bun build --compile`, supporting all major platforms for both direct download and Docker deployment.

## Target Platforms

| Platform | Target | Output |
|---|---|---|
| Linux x64 | `bun-linux-x64` | `openmantis-linux-x64` |
| Linux ARM64 | `bun-linux-arm64` | `openmantis-linux-arm64` |
| macOS x64 | `bun-darwin-x64` | `openmantis-darwin-x64` |
| macOS ARM64 | `bun-darwin-arm64` | `openmantis-darwin-arm64` |
| Windows x64 | `bun-windows-x64` | `openmantis-windows-x64.exe` |
| Windows ARM64 | `bun-windows-arm64` | `openmantis-windows-arm64.exe` |

## 1. Data Directory Migration

**Current:** All paths in `packages/common/src/paths/index.ts` are relative (`.openmantis/xxx`), depending on `process.cwd()`.

**Change:**
- Introduce `OPENMANTIS_HOME` = `process.env.OPENMANTIS_DATA_DIR || path.join(os.homedir(), ".openmantis")`
- All paths become absolute, based on `OPENMANTIS_HOME`
- Auto-create `~/.openmantis/` on first run
- No backward compatibility with the old relative path scheme

## 2. Web Frontend Embedding

**Current:** `web-server/src/server.ts` uses `import.meta.dir` relative path to find `dist/web/`, serves files via `serveStatic` and `Bun.file()`.

**Change:**
- Build script runs `bun run build:web` first to produce `dist/web/`
- Embed frontend assets into the binary via glob pattern: `bun build --compile ./src/index.ts ./dist/web/**/*`
- Rework `server.ts` to serve from `Bun.embeddedFiles` (compiled mode) or `dist/web/` (dev mode)
- Detect mode by checking `Bun.embeddedFiles.length > 0` — if true, serve from embedded files; otherwise fall back to `dist/web/` on disk (dev mode)
- `index.html` imported via `import with { type: "file" }` for SPA fallback
- `/assets/*` route serves matching blobs from embedded files with correct Content-Type

## 3. Skills System

**Current:** Three skill sources, all resolved via `import.meta.dir` backtracking to project root:
- `skills/builtin/` — built-in skills
- `skills/custom/` — user custom skills
- Config `skills.directory` — user-specified directory

**Change:**
- All skills load from `~/.openmantis/skills/` uniformly:
  - `~/.openmantis/skills/builtin/` — built-in skills (extracted from binary)
  - `~/.openmantis/skills/custom/` — user custom skills
  - `~/.openmantis/skills/<user-dir>/` — additional directories (config `skills.directory` still supported as absolute path)
- Remove all `import.meta.dir` backtracking in `skills.ts`
- `wrapSkillTool` workspace path changes to `OPENMANTIS_HOME/workspace/`

### Builtin Skills Initialization

- On startup, check if `~/.openmantis/skills/builtin/` exists
- If not, extract from `Bun.embeddedFiles` and write to disk
- If exists, skip (user may have modified)
- `openmantis init --force` subcommand to force re-extract (for version upgrades)
- Python scripts in skills still require Python runtime on user's system (documented)

## 4. Daemon Management in TypeScript

**Current:** `bin/openmantis` is a bash script handling start/stop/restart/status/log via `nohup` + PID file.

**Change:** Rewrite in TypeScript, compiled into the binary. The binary itself is the CLI entry point.

**Subcommands:**
| Command | Behavior |
|---|---|
| `openmantis start` | Fork self as background process (`Bun.spawn([process.execPath, "__daemon__"])`), write PID to `~/.openmantis/openmantis.pid` |
| `openmantis stop` | Read PID file, send SIGTERM, wait, SIGKILL on timeout |
| `openmantis restart` | stop + start |
| `openmantis status` | Check if PID is alive |
| `openmantis log` | Tail `~/.openmantis/openmantis.log` |
| `openmantis run` | Foreground execution (for Docker / development) |
| `openmantis init [--force]` | Extract builtin skills to `~/.openmantis/skills/builtin/` |

**Entry point logic:** If `process.argv` contains `__daemon__`, run main application logic directly. Otherwise, route through CLI subcommand handler.

## 5. Build Pipeline

**New file:** `scripts/build.ts`

**Steps:**
1. Run `bun run build:web` to produce `dist/web/`
2. Run `bun build --compile --minify --sourcemap --bytecode` with embedded assets:
   - `./dist/web/**/*` — frontend assets
   - `./skills/builtin/**/*` — builtin skills
3. Output to `dist/bin/<platform-specific-name>`

**Flags:**
- `--target <platform>` — cross-compile for specific target
- No flag — build for current platform

**package.json scripts:**
- `build:bin` — build binary for current platform
- `build:bin:all` — build binaries for all 6 targets

**Output directory:** `dist/bin/`

## 6. Files to Modify

| File | Change |
|---|---|
| `packages/common/src/paths/index.ts` | All paths based on `OPENMANTIS_HOME` absolute path |
| `packages/core/src/tools/skills.ts` | Unified skill loading from `OPENMANTIS_HOME/skills/`, remove `import.meta.dir` |
| `packages/web-server/src/server.ts` | Embedded resource serving with dev-mode fallback |
| `src/index.ts` | CLI entry point with daemon management + main logic |
| `scripts/build.ts` | New build automation script |
| `package.json` | Add `build:bin` and `build:bin:all` scripts |

## 7. Non-Goals (First Version)

- GitHub Actions CI auto-release (planned for later)
- Automatic migration from old `.openmantis/` relative path layout
- Bundling Python runtime for skills
