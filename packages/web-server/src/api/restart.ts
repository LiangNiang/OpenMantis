import { Hono } from "hono";
import { getIsRestarting, restartProcess } from "@openmantis/core/lifecycle";
import { err, ok } from "../types";

export function restartRoutes() {
	const app = new Hono();

	app.post("/", async (c) => {
		if (getIsRestarting()) {
			return c.json(err("Already restarting"), 409);
		}

		// Send response before restarting
		const response = c.json(ok({ restarting: true }));

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
