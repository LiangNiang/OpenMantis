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
		const name = (file as Blob & { name: string }).name;
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
