import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { createLogger } from "@openmantis/common/logger";

const logger = createLogger("web-server");
import { configRoutes } from "./api/config";
import { logsRoutes } from "./api/logs";
import { statusRoutes } from "./api/status";
import { authMiddleware } from "./middleware/auth";
import type { WebServerContext } from "./types";

export function createWebServer(ctx: WebServerContext) {
	const app = new Hono();

	app.use("/api/*", authMiddleware(ctx.authToken));

	app.route("/api/config", configRoutes(ctx));
	app.route("/api/status", statusRoutes(ctx));
	app.route("/api/logs", logsRoutes());

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

export async function startWebServer(ctx: WebServerContext): Promise<void> {
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

	Bun.serve({
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
}
