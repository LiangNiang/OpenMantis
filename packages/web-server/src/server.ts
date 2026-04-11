import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { createLogger } from "@openmantis/common/logger";

const logger = createLogger("web-server");
import { configRoutes } from "./api/config";
import { logsRoutes } from "./api/logs";
import { statusRoutes } from "./api/status";
import { authMiddleware } from "./middleware/auth";
import type { WebServerContext } from "./types";

export function createWebServer(ctx: WebServerContext) {
	const app = new Hono();

	const config = ctx.configStore.get();
	const host = config.web?.host ?? "127.0.0.1";
	const port = config.web?.port ?? 7777;
	const isLocal = host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0";

	const allowedOrigins: string[] = [];
	if (isLocal) {
		allowedOrigins.push(`http://127.0.0.1:${port}`, `http://localhost:${port}`);
		if (process.env.DEV_WEB) {
			const vitePort = process.env.WEB_DEV_PORT || 6666;
			allowedOrigins.push(`http://127.0.0.1:${vitePort}`, `http://localhost:${vitePort}`);
		}
	} else {
		allowedOrigins.push(`http://${host}:${port}`);
	}

	app.use(
		"*",
		cors({
			origin: allowedOrigins,
			credentials: true,
		}),
	);
	app.use("/api/*", authMiddleware(ctx.authToken));

	app.route("/api/config", configRoutes(ctx));
	app.route("/api/status", statusRoutes(ctx));
	app.route("/api/logs", logsRoutes());

	if (process.env.DEV_WEB) {
		const viteUrl = `http://localhost:${process.env.WEB_DEV_PORT || 6666}`;
		logger.info(`[web] DEV_WEB mode: proxying to Vite at ${viteUrl}`);

		// Proxy non-API requests to Vite dev server
		app.all("*", async (c, next) => {
			if (c.req.path.startsWith("/api")) return next();
			const url = new URL(c.req.url);
			const target = `${viteUrl}${url.pathname}${url.search}`;
			const res = await fetch(target, {
				method: c.req.method,
				headers: c.req.raw.headers,
				body:
					c.req.method !== "GET" && c.req.method !== "HEAD"
						? c.req.raw.body
						: undefined,
			});
			return new Response(res.body, {
				status: res.status,
				headers: res.headers,
			});
		});
	} else {
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
	}

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
