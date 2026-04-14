import { Hono } from "hono";
import { getIsRestarting, restartProcess } from "@openmantis/core/lifecycle";
import { isCompiledBinary } from "@openmantis/common/runtime";
import { err, ok } from "../types";

export function restartRoutes() {
	const app = new Hono();

	app.post("/", async (c) => {
		// Dev mode (non-compiled): respawning would orphan `bun --watch`
		// and break the reloader, so ask the user to restart manually.
		if (!isCompiledBinary()) {
			return c.json(ok({ restarting: false, devMode: true }));
		}

		if (getIsRestarting()) {
			return c.json(err("Already restarting"), 409);
		}

		// Send response before restarting
		const response = c.json(ok({ restarting: true, devMode: false }));

		// Schedule restart after response is sent
		setTimeout(async () => {
			try {
				await restartProcess();
			} catch {
				// logged inside restartProcess
			}
		}, 100);

		return response;
	});

	return app;
}
