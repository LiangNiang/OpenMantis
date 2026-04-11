import { Hono } from "hono";
import { resolveProvider } from "@openmantis/common/config/schema";
import type { WebServerContext } from "../types";
import { ok } from "../types";

const startedAt = Date.now();

export function statusRoutes(ctx: WebServerContext) {
	const app = new Hono();

	app.get("/", (c) => {
		const config = ctx.configStore.get();
		let defaultProviderInfo: { provider: string; model: string } = {
			provider: "unknown",
			model: "unknown",
		};
		try {
			const pc = resolveProvider(config, config.defaultProvider);
			defaultProviderInfo = { provider: pc.provider, model: pc.models[0]!.id };
		} catch {
			// default provider not found
		}
		return c.json(
			ok({
				uptime: Date.now() - startedAt,
				defaultProvider: config.defaultProvider,
				provider: defaultProviderInfo.provider,
				model: defaultProviderInfo.model,
				providers: config.providers.map((p) => ({
					name: p.name,
					provider: p.provider,
					model: p.models[0]!.id,
				})),
				channels: config.channels,
				hasConfig: ctx.configStore.hasConfig(),
			}),
		);
	});

	return app;
}
