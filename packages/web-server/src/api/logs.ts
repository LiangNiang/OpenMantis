// packages/web-server/src/api/logs.ts
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { LOG_FILE } from "@openmantis/common/paths";
import { ok } from "../types";

const TAIL_MAX_BYTES = 256 * 1024; // 256KB
const TAIL_DEFAULT_LINES = 500;
const TAIL_MAX_LINES = 5000;
const STREAM_TICK_MS = 500;
// Must be shorter than Bun.serve idleTimeout (default 10s) to keep the
// connection alive when the log file is quiet, otherwise Bun closes the
// stream and the browser reports ERR_INCOMPLETE_CHUNKED_ENCODING.
const SSE_PING_MS = 5_000;

const LOG_PATH = resolve(process.cwd(), LOG_FILE);

async function getFileSize(path: string): Promise<number> {
	try {
		const s = await stat(path);
		return s.size;
	} catch {
		return 0;
	}
}

async function readTail(lines: number): Promise<string[]> {
	const size = await getFileSize(LOG_PATH);
	if (size === 0) return [];
	const start = Math.max(0, size - TAIL_MAX_BYTES);
	const slice = Bun.file(LOG_PATH).slice(start, size);
	const text = await slice.text();
	const all = text.split("\n");
	// 第一行可能是被截断的半行，丢弃（除非从文件开头读）
	const usable = start === 0 ? all : all.slice(1);
	// 末尾通常是空字符串（trailing \n），过滤
	const nonEmpty = usable.filter((l) => l.length > 0);
	return nonEmpty.slice(-lines);
}

export function logsRoutes() {
	const app = new Hono();

	app.get("/tail", async (c) => {
		const linesParam = Number(c.req.query("lines") ?? TAIL_DEFAULT_LINES);
		const lines = Math.max(1, Math.min(TAIL_MAX_LINES, Number.isFinite(linesParam) ? linesParam : TAIL_DEFAULT_LINES));
		const result = await readTail(lines);
		return c.json(ok({ lines: result }));
	});

	app.get("/stream", (c) => {
		return streamSSE(c, async (stream) => {
			// Force-flush headers immediately so EventSource.onopen fires even
			// when the log is quiet and proxies (Vite, nginx) buffer until first byte.
			await stream.writeSSE({ data: "", event: "hello" });

			let currentSize = await getFileSize(LOG_PATH);

			let lastPing = Date.now();

			while (!stream.aborted) {
				try {
					const newSize = await getFileSize(LOG_PATH);
					if (newSize === 0) {
						// file doesn't exist yet
					} else {
						if (newSize < currentSize) currentSize = 0;
						if (newSize > currentSize) {
							const slice = Bun.file(LOG_PATH).slice(currentSize, newSize);
							const text = await slice.text();
							currentSize = newSize;
							const lines = text.split("\n").filter((l) => l.length > 0);
							for (const line of lines) {
								await stream.writeSSE({ data: line });
							}
						}
					}
				} catch {
					// swallow read errors and keep ticking
				}

				if (Date.now() - lastPing > SSE_PING_MS) {
					try {
						await stream.writeSSE({ data: "", event: "ping" });
					} catch {
						// client gone, next loop iteration will see stream.aborted
					}
					lastPing = Date.now();
				}

				await stream.sleep(STREAM_TICK_MS);
			}
		});
	});

	app.get("/download", async (c) => {
		const file = Bun.file(LOG_PATH);
		if (!(await file.exists())) {
			return c.text("Log file not found", 404);
		}
		c.header("Content-Type", "text/plain; charset=utf-8");
		c.header("Content-Disposition", 'attachment; filename="openmantis.log"');
		return c.body(file.stream());
	});

	return app;
}
