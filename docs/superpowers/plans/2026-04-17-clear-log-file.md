# Clear Log File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side "clear log file" button to the /logs page that truncates `openmantis.log` to 0 bytes.

**Architecture:** New `DELETE /api/logs` endpoint truncates the log file. Frontend adds a new button with confirmation dialog (AlertDialog) that calls this endpoint and then clears the UI display.

**Tech Stack:** Hono (backend), React 19, shadcn/ui AlertDialog, Bun runtime

---

### Task 1: Add AlertDialog component via shadcn

**Files:**
- Create: `packages/web/src/components/ui/alert-dialog.tsx`

- [ ] **Step 1: Install AlertDialog**

```bash
cd packages/web && bunx shadcn@latest add alert-dialog -y
```

- [ ] **Step 2: Verify installation**

```bash
ls packages/web/src/components/ui/alert-dialog.tsx
```

Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ui/alert-dialog.tsx
git commit -m "feat(web): add shadcn alert-dialog component"
```

---

### Task 2: Add DELETE endpoint to web-server

**Files:**
- Modify: `packages/web-server/src/api/logs.ts`

- [ ] **Step 1: Add the DELETE handler**

In `packages/web-server/src/api/logs.ts`, add this route inside the `logsRoutes()` function, after the `/download` route and before `return app`:

```typescript
app.delete("/", async (c) => {
	const file = Bun.file(LOG_PATH);
	if (!(await file.exists())) {
		return c.body(null, 204);
	}
	await Bun.write(LOG_PATH, "");
	return c.body(null, 204);
});
```

This truncates the file to empty using `Bun.write` (which truncates on write). Returns 204 whether the file existed or not — idempotent.

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/liang/self-p/OpenMantis && bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web-server/src/api/logs.ts
git commit -m "feat(web-server): add DELETE /api/logs endpoint to truncate log file"
```

---

### Task 3: Add i18n keys for clear file button and confirmation dialog

**Files:**
- Modify: `packages/web/src/i18n/locales/en.json`
- Modify: `packages/web/src/i18n/locales/zh.json`

- [ ] **Step 1: Add English keys**

Add the following keys to `packages/web/src/i18n/locales/en.json`:

```json
"logs.clearFile": "Clear File",
"logs.clearFileTitle": "Clear Log File",
"logs.clearFileDesc": "This will permanently delete all log contents. This action cannot be undone.",
"logs.clearFileConfirm": "Clear",
"logs.clearFileCancel": "Cancel"
```

- [ ] **Step 2: Add Chinese keys**

Add the following keys to `packages/web/src/i18n/locales/zh.json`:

```json
"logs.clearFile": "清空文件",
"logs.clearFileTitle": "清空日志文件",
"logs.clearFileDesc": "将永久删除所有日志内容，此操作不可撤销。",
"logs.clearFileConfirm": "清空",
"logs.clearFileCancel": "取消"
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/i18n/locales/en.json packages/web/src/i18n/locales/zh.json
git commit -m "feat(web): add i18n keys for clear log file dialog"
```

---

### Task 4: Add clear file button and confirmation dialog to logs page

**Files:**
- Modify: `packages/web/src/pages/logs.tsx`

- [ ] **Step 1: Add imports and state**

Add imports at the top of `packages/web/src/pages/logs.tsx`:

```typescript
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
```

- [ ] **Step 2: Add the clearFile handler**

Inside the `LogsPage` component, after the existing destructuring of `useLogStream()`, add:

```typescript
const [clearing, setClearing] = useState(false);

const clearFile = useCallback(async () => {
	setClearing(true);
	try {
		await fetch("/api/logs", { method: "DELETE" });
		clear();
	} finally {
		setClearing(false);
	}
}, [clear]);
```

- [ ] **Step 3: Add the button with AlertDialog**

In the button toolbar `<div className="flex gap-2">`, after the existing clear button (`<Button variant="outline" size="sm" onClick={clear}>`), add:

```tsx
<AlertDialog>
	<AlertDialogTrigger asChild>
		<Button variant="outline" size="sm" disabled={clearing}>
			{t("logs.clearFile")}
		</Button>
	</AlertDialogTrigger>
	<AlertDialogContent>
		<AlertDialogHeader>
			<AlertDialogTitle>{t("logs.clearFileTitle")}</AlertDialogTitle>
			<AlertDialogDescription>{t("logs.clearFileDesc")}</AlertDialogDescription>
		</AlertDialogHeader>
		<AlertDialogFooter>
			<AlertDialogCancel>{t("logs.clearFileCancel")}</AlertDialogCancel>
			<AlertDialogAction onClick={clearFile}>
				{t("logs.clearFileConfirm")}
			</AlertDialogAction>
		</AlertDialogFooter>
	</AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 4: Verify typecheck and lint**

```bash
cd /Users/liang/self-p/OpenMantis && bun run typecheck && bun run check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/logs.tsx
git commit -m "feat(web): add clear log file button with confirmation dialog"
```

---

### Task 5: Manual testing

- [ ] **Step 1: Start dev server**

```bash
cd /Users/liang/self-p/OpenMantis && bun run dev:full
```

- [ ] **Step 2: Test in browser**

1. Open the /logs page
2. Verify both "Clear" (清屏) and "Clear File" (清空文件) buttons are visible
3. Click "Clear File" — confirmation dialog should appear
4. Click "Cancel" — dialog dismisses, nothing happens
5. Click "Clear File" again, then confirm — log display should clear and the file on disk should be empty
6. Verify new logs continue to appear after clearing (the stream should still work since we truncated rather than deleted)

- [ ] **Step 3: Verify file truncation**

```bash
wc -c ~/.openmantis/openmantis.log
```

Expected: `0` bytes after clearing.
