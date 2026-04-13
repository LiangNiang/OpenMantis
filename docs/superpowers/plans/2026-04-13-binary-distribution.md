# Binary Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package OpenMantis as a single self-contained binary via `bun build --compile` with embedded web frontend and builtin skills, full CLI daemon management, and cross-platform support.

**Architecture:** Migrate all runtime paths from relative (cwd-based) to absolute (`~/.openmantis/`). Embed Vite-built frontend and builtin skills into the binary. Rewrite the bash daemon management script as TypeScript CLI compiled into the binary. Add `scripts/build.ts` to automate the multi-platform build pipeline.

**Tech Stack:** Bun (compile, spawn, embeddedFiles), Hono (web server), Vite (frontend build)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/common/src/paths/index.ts` | Modify | Change all paths to absolute based on `OPENMANTIS_HOME` |
| `packages/core/src/tools/skills.ts` | Modify | Unified skill loading from `OPENMANTIS_HOME/skills/` |
| `packages/core/src/tools/bash.ts` | Modify | Update hardcoded `.openmantis/workspace` references |
| `packages/core/src/lifecycle.ts` | Modify | Use `process.execPath` instead of `bun` for restart |
| `packages/web-server/src/server.ts` | Modify | Serve from embedded files or disk (dev mode) |
| `src/cli.ts` | Create | CLI entry point with subcommand routing (start/stop/restart/status/log/run/init) |
| `src/daemon.ts` | Create | Daemon management logic (fork, PID, signal handling) |
| `src/init.ts` | Create | Extract embedded builtin skills to disk |
| `src/index.ts` | Modify | Refactor to export `main()`, called by cli.ts |
| `scripts/build.ts` | Create | Build automation (web + compile) |
| `package.json` | Modify | Add `build:bin` and `build:bin:all` scripts |

---

### Task 1: Migrate paths to absolute `OPENMANTIS_HOME`

**Files:**
- Modify: `packages/common/src/paths/index.ts`

- [ ] **Step 1: Rewrite paths/index.ts**

Replace all relative path definitions with absolute paths based on `OPENMANTIS_HOME`:

```ts
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const OPENMANTIS_HOME =
	process.env.OPENMANTIS_DATA_DIR || join(homedir(), ".openmantis");

export const LOG_FILE = join(OPENMANTIS_HOME, "openmantis.log");
export const PID_FILE = join(OPENMANTIS_HOME, "openmantis.pid");
export const CONFIG_FILE = join(OPENMANTIS_HOME, "config.json");
export const ROUTES_DIR = join(OPENMANTIS_HOME, "routes");
export const SCHEDULES_DIR = join(OPENMANTIS_HOME, "schedules");
export const CHANNEL_BINDINGS_FILE = join(OPENMANTIS_HOME, "channel-bindings.json");
export const TTS_DIR = join(OPENMANTIS_HOME, "tts");
export const UPLOADS_DIR = join(OPENMANTIS_HOME, "uploads");
export const TMP_DIR = join(OPENMANTIS_HOME, "tmp");
export const MEMORIES_DIR = join(OPENMANTIS_HOME, "memories");
export const WORKSPACE_DIR = join(OPENMANTIS_HOME, "workspace");
export const SKILLS_DIR = join(OPENMANTIS_HOME, "skills");

export const BROWSER_PROFILES_DIR = join(OPENMANTIS_HOME, "browser-profiles");

export function browserProfileDir(routeId: string): string {
	return join(BROWSER_PROFILES_DIR, routeId);
}

export function routeFile(id: string): string {
	return join(ROUTES_DIR, `${id}.json`);
}

export function scheduleFile(id: string): string {
	return join(SCHEDULES_DIR, `${id}.json`);
}

/** Ensure the directory containing `path` exists (recursive). */
export function ensureParentDir(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
}

/** Ensure `path` itself exists as a directory (recursive). */
export function ensureDir(path: string): void {
	mkdirSync(path, { recursive: true });
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS — all existing imports of path constants remain unchanged

- [ ] **Step 3: Commit**

```bash
git add packages/common/src/paths/index.ts
git commit -m "refactor(common): migrate paths to absolute OPENMANTIS_HOME"
```

---

### Task 2: Update skills.ts to load from OPENMANTIS_HOME/skills/

**Files:**
- Modify: `packages/core/src/tools/skills.ts`

- [ ] **Step 1: Replace skill directory resolution**

In `createSkillTools` (line 253-323), replace the three skill source blocks with unified loading from `SKILLS_DIR`:

```ts
// Add import at top:
import { SKILLS_DIR, WORKSPACE_DIR } from "@openmantis/common/paths";

// Replace the entire body of createSkillTools:
export async function createSkillTools(config?: OpenMantisConfig) {
	const skillsConfig = config?.skills;
	let instructions = "";
	const tools: Record<string, Tool> = {};

	// Built-in skills
	if (skillsConfig?.builtinEnabled !== false) {
		const builtinDir = join(SKILLS_DIR, "builtin");
		if (existsSync(builtinDir)) {
			try {
				let skills = await discoverSkills(builtinDir, "skills/builtin");
				if (config?.browser?.enabled !== true) {
					skills = skills.filter((s) => s.name !== BROWSER_SKILL_NAME);
				}
				if (skills.length > 0) {
					instructions += `${generateSkillInstructions(skills)}\n`;
					const loaderTool = createSkillLoaderTool(skills);
					const wrapped = wrapSkillTool(loaderTool);
					for (const skill of skills) {
						tools[`skill_${skill.name}`] = wrapped;
					}
					logger.debug(`[skills] loaded ${skills.length} builtin skills`);
				}
			} catch (err) {
				logger.error(`[skills] failed to load builtin skills: ${err}`);
			}
		}
	}

	// Custom skills
	const customDir = join(SKILLS_DIR, "custom");
	if (existsSync(customDir)) {
		try {
			const skills = await discoverSkills(customDir, "skills/custom");
			if (skills.length > 0) {
				instructions += `${generateSkillInstructions(skills)}\n`;
				const loaderTool = createSkillLoaderTool(skills);
				const wrapped = wrapSkillTool(loaderTool);
				for (const skill of skills) {
					tools[`skill_${skill.name}`] = wrapped;
				}
				logger.debug(`[skills] loaded ${skills.length} custom skills`);
			}
		} catch (err) {
			logger.error(`[skills] failed to load custom skills: ${err}`);
		}
	}

	return { instructions, tools };
}
```

- [ ] **Step 2: Update wrapSkillTool to use WORKSPACE_DIR**

Replace line 210-211 in `wrapSkillTool`:

```ts
// Before:
const projectRoot = process.cwd();
const workspace = `${projectRoot}/.openmantis/workspace`;

// After:
const workspace = WORKSPACE_DIR;
```

- [ ] **Step 3: Update hardcoded `.openmantis/workspace` in bash.ts**

In `packages/core/src/tools/bash.ts`, find all string references to `.openmantis/workspace` and replace with the imported `WORKSPACE_DIR` constant. There are references around lines 168-169 and 205-206 in the prompt strings. Import `WORKSPACE_DIR` from `@openmantis/common/paths` and use template literals:

```ts
import { WORKSPACE_DIR } from "@openmantis/common/paths";

// Replace all `.openmantis/workspace` occurrences in prompt strings with ${WORKSPACE_DIR}
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tools/skills.ts packages/core/src/tools/bash.ts
git commit -m "refactor(core): load skills from OPENMANTIS_HOME/skills/"
```

---

### Task 3: Update lifecycle.ts for binary restart

**Files:**
- Modify: `packages/core/src/lifecycle.ts`

- [ ] **Step 1: Replace `bun` with `process.execPath`**

In `restartProcess()` (line 41), change the spawn command:

```ts
// Before:
const child = Bun.spawn(["bun", ...args], {

// After:
const child = Bun.spawn([process.execPath, ...args], {
```

This ensures that when running as a compiled binary, the restart spawns the binary itself rather than looking for `bun`.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/lifecycle.ts
git commit -m "fix(core): use process.execPath for restart to support binary mode"
```

---

### Task 4: Rework web-server to serve embedded assets

**Files:**
- Modify: `packages/web-server/src/server.ts`

- [ ] **Step 1: Rewrite server.ts to support both embedded and disk modes**

```ts
import { join } from "node:path";
import type { Server } from "bun";
type WebServer = Server<unknown>;
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createLogger } from "@openmantis/common/logger";

const logger = createLogger("web-server");
import { configRoutes } from "./api/config";
import { logsRoutes } from "./api/logs";
import { restartRoutes } from "./api/restart";
import { statusRoutes } from "./api/status";
import { authMiddleware } from "./middleware/auth";
import type { WebServerContext } from "./types";

const MIME_TYPES: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
};

function getMimeType(path: string): string {
	const ext = path.slice(path.lastIndexOf("."));
	return MIME_TYPES[ext] || "application/octet-stream";
}

function createEmbeddedWebServer(ctx: WebServerContext) {
	const app = new Hono();

	app.use("/api/*", authMiddleware(ctx.authToken));
	app.route("/api/config", configRoutes(ctx));
	app.route("/api/status", statusRoutes(ctx));
	app.route("/api/logs", logsRoutes());
	app.route("/api/restart", restartRoutes());

	// Build asset map from embedded files
	const assets = new Map<string, Blob>();
	let indexHtml: Blob | undefined;
	for (const file of Bun.embeddedFiles) {
		const name = file.name;
		const webIdx = name.indexOf("dist/web/");
		if (webIdx !== -1) {
			const relativePath = name.slice(webIdx + "dist/web/".length);
			assets.set(relativePath, file);
			if (relativePath === "index.html") {
				indexHtml = file;
			}
		}
	}

	// Serve embedded assets
	app.get("/assets/*", async (c) => {
		const assetPath = c.req.path.slice(1); // remove leading /
		const blob = assets.get(assetPath);
		if (!blob) return c.notFound();
		return new Response(blob, {
			headers: { "Content-Type": getMimeType(assetPath) },
		});
	});

	// SPA fallback
	app.get("*", async (c) => {
		if (!indexHtml) return c.text("Web UI not available in this build", 500);
		const html = await indexHtml.text();
		return c.html(html);
	});

	return app;
}

function createDiskWebServer(ctx: WebServerContext) {
	const app = new Hono();

	app.use("/api/*", authMiddleware(ctx.authToken));
	app.route("/api/config", configRoutes(ctx));
	app.route("/api/status", statusRoutes(ctx));
	app.route("/api/logs", logsRoutes());
	app.route("/api/restart", restartRoutes());

	// Static files from dist/web/
	const distDir = join(import.meta.dir, "../../../dist/web");
	app.use("/assets/*", serveStatic({ root: distDir, rewriteRequestPath: (path) => path }));

	// SPA fallback
	app.get("*", async (c) => {
		try {
			const html = await Bun.file(join(distDir, "index.html")).text();
			return c.html(html);
		} catch {
			return c.text("Web UI not built. Run: bun run build:web", 500);
		}
	});

	return app;
}

export function createWebServer(ctx: WebServerContext) {
	const isCompiled = Bun.embeddedFiles.length > 0;
	if (isCompiled) {
		logger.debug("[web] Serving embedded web assets");
		return createEmbeddedWebServer(ctx);
	}
	logger.debug("[web] Serving web assets from disk");
	return createDiskWebServer(ctx);
}

export async function startWebServer(ctx: WebServerContext): Promise<WebServer> {
	const config = ctx.configStore.get();
	const host = config.web?.host ?? "127.0.0.1";
	const port = config.web?.port ?? 7777;

	let authToken = config.web?.authToken;
	if (host !== "127.0.0.1" && host !== "localhost" && !authToken) {
		authToken = crypto.randomUUID();
		await ctx.configStore.update({ web: { authToken } });
		logger.info(`[web] Auth token generated and saved to config (use authToken from config.json)`);
	}
	ctx.authToken = authToken;

	const app = createWebServer(ctx);

	const server = Bun.serve({
		fetch: app.fetch,
		hostname: host,
		port,
	});

	const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
	const tokenSuffix = authToken ? `?token=${authToken}` : "";

	if (!ctx.configStore.hasConfig()) {
		logger.info(`[web] First-time setup: visit ${url}${tokenSuffix} to configure`);
	} else {
		logger.info(`[web] Config dashboard: ${url}${tokenSuffix}`);
	}

	return server;
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web-server/src/server.ts
git commit -m "feat(web-server): serve embedded assets in compiled binary mode"
```

---

### Task 5: Create skills initializer

**Files:**
- Create: `src/init.ts`

- [ ] **Step 1: Create src/init.ts**

```ts
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SKILLS_DIR } from "@openmantis/common/paths";
import { createLogger } from "@openmantis/common/logger";

const logger = createLogger("init");

/**
 * Extract embedded builtin skills to ~/.openmantis/skills/builtin/.
 * Skips if the directory already exists unless force=true.
 */
export async function initBuiltinSkills(force = false): Promise<void> {
	const builtinDir = join(SKILLS_DIR, "builtin");

	if (existsSync(builtinDir) && !force) {
		logger.debug("[init] builtin skills already exist, skipping extraction");
		return;
	}

	const embeddedSkills = Bun.embeddedFiles.filter((f) =>
		f.name.includes("skills/builtin/"),
	);

	if (embeddedSkills.length === 0) {
		logger.debug("[init] no embedded builtin skills found");
		return;
	}

	logger.info(`[init] extracting ${embeddedSkills.length} builtin skill files...`);

	for (const file of embeddedSkills) {
		const name = file.name;
		const skillIdx = name.indexOf("skills/builtin/");
		if (skillIdx === -1) continue;

		const relativePath = name.slice(skillIdx + "skills/builtin/".length);
		const targetPath = join(builtinDir, relativePath);

		await mkdir(dirname(targetPath), { recursive: true });
		const content = await file.arrayBuffer();
		await writeFile(targetPath, new Uint8Array(content));
	}

	logger.info("[init] builtin skills extracted successfully");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/init.ts
git commit -m "feat: add builtin skills extraction from embedded files"
```

---

### Task 6: Create daemon management module

**Files:**
- Create: `src/daemon.ts`

- [ ] **Step 1: Create src/daemon.ts**

```ts
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { createLogger } from "@openmantis/common/logger";
import { LOG_FILE, PID_FILE, OPENMANTIS_HOME, ensureDir } from "@openmantis/common/paths";

const logger = createLogger("daemon");

function getPid(): number | null {
	try {
		if (!existsSync(PID_FILE)) return null;
		const content = Bun.file(PID_FILE);
		// Use sync read for simplicity in CLI context
		const pid = Number.parseInt(
			new TextDecoder().decode(
				// @ts-expect-error — sync read from Bun.file for small PID file
				Bun.readableStreamToArrayBuffer(content.stream()),
			).trim(),
		);
		return Number.isNaN(pid) ? null : pid;
	} catch {
		return null;
	}
}

async function readPid(): Promise<number | null> {
	try {
		if (!existsSync(PID_FILE)) return null;
		const content = await readFile(PID_FILE, "utf-8");
		const pid = Number.parseInt(content.trim());
		return Number.isNaN(pid) ? null : pid;
	} catch {
		return null;
	}
}

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function daemonStart(): Promise<void> {
	ensureDir(OPENMANTIS_HOME);

	const existingPid = await readPid();
	if (existingPid && isRunning(existingPid)) {
		console.log(`OpenMantis is already running (PID ${existingPid})`);
		process.exit(1);
	}

	console.log("Starting OpenMantis...");

	const child = Bun.spawn([process.execPath, "__daemon__"], {
		stdio: ["ignore", "ignore", "ignore"],
		env: process.env,
	});
	child.unref();

	const pid = child.pid;
	await Bun.write(PID_FILE, String(pid));

	// Wait a moment to check if the process started successfully
	await Bun.sleep(1000);

	if (isRunning(pid)) {
		console.log(`OpenMantis started (PID ${pid})`);
	} else {
		try { await unlink(PID_FILE); } catch {}
		console.error(`Error: OpenMantis failed to start. Check log: ${LOG_FILE}`);
		process.exit(1);
	}
}

export async function daemonStop(): Promise<void> {
	const pid = await readPid();
	if (!pid || !isRunning(pid)) {
		console.log("OpenMantis is not running");
		try { await unlink(PID_FILE); } catch {}
		return;
	}

	console.log(`Stopping OpenMantis (PID ${pid})...`);
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		console.error(`Error: could not send SIGTERM to PID ${pid}`);
		try { await unlink(PID_FILE); } catch {}
		return;
	}

	// Wait up to 5 seconds for graceful shutdown
	for (let i = 0; i < 5; i++) {
		if (!isRunning(pid)) break;
		await Bun.sleep(1000);
	}

	if (isRunning(pid)) {
		console.log("Force killing...");
		try { process.kill(pid, "SIGKILL"); } catch {}
		await Bun.sleep(1000);
	}

	try { await unlink(PID_FILE); } catch {}
	console.log("OpenMantis stopped");
}

export async function daemonRestart(): Promise<void> {
	await daemonStop();
	await daemonStart();
}

export async function daemonStatus(): Promise<void> {
	const pid = await readPid();
	if (pid && isRunning(pid)) {
		console.log(`OpenMantis is running (PID ${pid})`);
	} else {
		console.log("OpenMantis is not running");
		if (pid) {
			try { await unlink(PID_FILE); } catch {}
		}
	}
}

export async function daemonLog(): Promise<void> {
	if (!existsSync(LOG_FILE)) {
		console.log(`No log file found at ${LOG_FILE}`);
		process.exit(1);
	}

	// Tail the log file
	const proc = Bun.spawn(["tail", "-f", LOG_FILE], {
		stdio: ["inherit", "inherit", "inherit"],
	});
	await proc.exited;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/daemon.ts
git commit -m "feat: add TypeScript daemon management module"
```

---

### Task 7: Create CLI entry point and refactor src/index.ts

**Files:**
- Create: `src/cli.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Refactor src/index.ts to export main()**

Move the `main()` function to be an exported function. Remove the top-level `main().catch(...)` call. Add log file redirection for daemon mode. The file should end with:

```ts
// At the very end of src/index.ts, replace:
// main().catch((err) => { ... });

// With nothing — main() is now called by cli.ts
```

Also add stdout/stderr redirection at the top of `main()` for daemon mode (when output needs to go to log file). This is handled by cli.ts before calling main.

Export `main` as a named export:

```ts
export async function main() {
	// ... existing body unchanged ...
}
```

Remove the bottom `main().catch(...)` block entirely.

- [ ] **Step 2: Create src/cli.ts as the new entry point**

```ts
import { ensureDir, OPENMANTIS_HOME, LOG_FILE } from "@openmantis/common/paths";
import { daemonLog, daemonStart, daemonStatus, daemonStop, daemonRestart } from "./daemon";
import { initBuiltinSkills } from "./init";

const USAGE = `Usage: openmantis <command>

Commands:
  start     Start OpenMantis (daemon)
  stop      Stop OpenMantis
  restart   Restart OpenMantis
  status    Show running status
  log       Tail the log file
  run       Run in foreground (for Docker / development)
  init      Extract builtin skills (--force to overwrite)
`;

async function runForeground(): Promise<void> {
	ensureDir(OPENMANTIS_HOME);
	await initBuiltinSkills();
	const { main } = await import("./index");
	await main();
}

async function runDaemon(): Promise<void> {
	// Redirect stdout/stderr to log file in daemon mode
	// This is called when the process is spawned with "__daemon__" arg
	ensureDir(OPENMANTIS_HOME);
	await initBuiltinSkills();

	const logFile = Bun.file(LOG_FILE);
	const writer = logFile.writer();
	const originalLog = console.log;
	const originalError = console.error;

	// Redirect console output to log file
	const writeToLog = (...args: unknown[]) => {
		const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
		writer.write(`${msg}\n`);
		writer.flush();
	};
	console.log = writeToLog;
	console.error = writeToLog;

	try {
		const { main } = await import("./index");
		await main();
	} catch (err) {
		writeToLog(`Failed to start OpenMantis: ${err}`);
		process.exit(1);
	}
}

async function cli(): Promise<void> {
	const command = process.argv[2];

	// Internal daemon entry point
	if (command === "__daemon__") {
		await runDaemon();
		return;
	}

	switch (command) {
		case "start":
			await daemonStart();
			break;
		case "stop":
			await daemonStop();
			break;
		case "restart":
			await daemonRestart();
			break;
		case "status":
			await daemonStatus();
			break;
		case "log":
			await daemonLog();
			break;
		case "run":
			await runForeground();
			break;
		case "init": {
			ensureDir(OPENMANTIS_HOME);
			const force = process.argv.includes("--force");
			await initBuiltinSkills(force);
			console.log("Initialization complete");
			break;
		}
		default:
			console.log(USAGE);
			if (command && command !== "--help" && command !== "-h") {
				process.exit(1);
			}
			break;
	}
}

cli().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Test foreground mode in dev**

Run: `bun src/cli.ts run`
Expected: OpenMantis starts in foreground mode normally

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/index.ts
git commit -m "feat: add CLI entry point with daemon management"
```

---

### Task 8: Create build script

**Files:**
- Create: `scripts/build.ts`
- Modify: `package.json`

- [ ] **Step 1: Create scripts/build.ts**

```ts
import { $ } from "bun";

const TARGETS = [
	{ target: "bun-linux-x64", output: "openmantis-linux-x64" },
	{ target: "bun-linux-arm64", output: "openmantis-linux-arm64" },
	{ target: "bun-darwin-x64", output: "openmantis-darwin-x64" },
	{ target: "bun-darwin-arm64", output: "openmantis-darwin-arm64" },
	{ target: "bun-windows-x64", output: "openmantis-windows-x64.exe" },
	{ target: "bun-windows-arm64", output: "openmantis-windows-arm64.exe" },
] as const;

async function buildWeb() {
	console.log("Building web frontend...");
	await $`bun run build:web`;
	console.log("Web frontend built.");
}

async function compile(target?: string) {
	const targets = target
		? TARGETS.filter((t) => t.target === target)
		: [undefined]; // current platform

	if (target && targets.length === 0) {
		console.error(`Unknown target: ${target}`);
		console.error(`Available: ${TARGETS.map((t) => t.target).join(", ")}`);
		process.exit(1);
	}

	for (const t of targets) {
		const outfile = t
			? `dist/bin/${t.output}`
			: "dist/bin/openmantis";
		const targetArgs = t ? ["--target", t.target] : [];

		console.log(`Compiling${t ? ` for ${t.target}` : ""}...`);

		await $`bun build --compile \
			--minify \
			--sourcemap \
			--bytecode \
			${targetArgs} \
			--outfile ${outfile} \
			./src/cli.ts \
			./dist/web/**/* \
			./skills/builtin/**/*`;

		console.log(`Built: ${outfile}`);
	}
}

async function main() {
	const args = process.argv.slice(2);
	const targetFlag = args.indexOf("--target");
	const target = targetFlag !== -1 ? args[targetFlag + 1] : undefined;
	const all = args.includes("--all");

	await buildWeb();

	if (all) {
		for (const t of TARGETS) {
			await compile(t.target);
		}
	} else {
		await compile(target);
	}
}

main().catch((err) => {
	console.error("Build failed:", err);
	process.exit(1);
});
```

- [ ] **Step 2: Add scripts to package.json**

Add to the `"scripts"` section of the root `package.json`:

```json
"build:bin": "bun scripts/build.ts",
"build:bin:all": "bun scripts/build.ts --all"
```

- [ ] **Step 3: Add `dist/bin/` to .gitignore**

Append to `.gitignore`:

```
dist/bin/
```

- [ ] **Step 4: Commit**

```bash
git add scripts/build.ts package.json .gitignore
git commit -m "feat: add binary build script with cross-platform support"
```

---

### Task 9: Test full build and verify binary

- [ ] **Step 1: Build binary for current platform**

Run: `bun run build:bin`
Expected: Produces `dist/bin/openmantis`

- [ ] **Step 2: Test binary commands**

Run each command and verify behavior:

```bash
./dist/bin/openmantis --help     # Should print usage
./dist/bin/openmantis init       # Should extract builtin skills to ~/.openmantis/skills/builtin/
./dist/bin/openmantis run        # Should start in foreground (Ctrl+C to stop)
./dist/bin/openmantis start      # Should start daemon
./dist/bin/openmantis status     # Should show "running"
./dist/bin/openmantis stop       # Should stop daemon
```

- [ ] **Step 3: Verify embedded web UI works**

Start with `./dist/bin/openmantis run`, open `http://localhost:7777` in browser, confirm the web dashboard loads correctly with all assets.

- [ ] **Step 4: Verify skills extracted**

```bash
ls ~/.openmantis/skills/builtin/
```

Expected: docx/, xlsx/, frontend-design/ directories with their files

- [ ] **Step 5: Run linting and typecheck**

```bash
bun run check
bun run typecheck
```

Expected: PASS

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: final adjustments after binary build testing"
```
