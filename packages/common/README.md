# @openmantis/common

Lowest-layer shared package for OpenMantis. Contains types, schemas, and zero-state infrastructure used by 2+ packages.

## Accession rules

Before adding anything to `common`, it must satisfy **all three** rules:

1. **Zero workspace dependencies.** `common` MUST NOT import from any other `@openmantis/*` package. Doing so creates cycles. Only third-party deps (`ai`, `consola`, `zod`, Node built-ins) are allowed.
2. **Stateless or constants only.** Pure functions, Zod schemas, type definitions, constants, and factory functions are allowed. Singleton services, file watchers, persistent fs state, and anything that retains mutable state across calls are NOT allowed — those belong in their owning package (typically `core`).
3. **Used by ≥2 packages.** If only one package needs it, it stays in that package. Move things to `common` when the second consumer appears.

If a candidate fails any of the three, it does not belong in `common`.

## Layout

- `src/types/*` — TypeScript interface/type definitions (channels, scheduler, tools, tts).
- `src/paths/` — Single source of truth for `.openmantis/*` directory and file paths.
- `src/logger/` — `createLogger(tag)` factory backed by consola + file reporter.
- `src/config/` — Zod schemas, sensitive-field masking, and config merge helpers (no fs/state).
