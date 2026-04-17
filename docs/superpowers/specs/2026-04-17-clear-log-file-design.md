# Clear Log File Feature

## Overview

Add a "clear log file" button to the `/logs` page that truncates the server-side `openmantis.log` file to zero bytes. This is separate from the existing "clear display" button which only clears the UI.

## Backend

New endpoint in `packages/web-server/src/api/logs.ts`:

- **`DELETE /api/logs`** — Truncates `openmantis.log` to 0 bytes using `truncate(0)`. Returns `204 No Content` on success. Truncation (vs deletion) ensures the file handle remains valid for any process currently writing to it.

## Frontend

In `packages/web/src/pages/logs.tsx`:

- Add a new button alongside the existing toolbar buttons, visually distinct (e.g. destructive variant) to signal the irreversible nature of the action.
- On click, show a confirmation dialog (using existing shadcn AlertDialog) since truncation is not reversible.
- On confirm: call `DELETE /api/logs`, then invoke the existing `clear()` from `use-log-stream` to also reset the UI display.

## Flow

```
User clicks "清空日志文件"
  → Confirmation dialog
  → User confirms
  → DELETE /api/logs
  → Server truncates openmantis.log to 0 bytes
  → Returns 204
  → UI calls clear() to reset displayed lines
```

## Files Changed

1. `packages/web-server/src/api/logs.ts` — Add DELETE handler
2. `packages/web/src/pages/logs.tsx` — Add button + confirmation dialog
