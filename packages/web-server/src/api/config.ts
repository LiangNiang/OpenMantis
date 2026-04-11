import { Hono } from "hono";
import { z } from "zod";
import { toJSONSchema } from "zod";
import { configSchema } from "@openmantis/common/config/schema";
import { maskSensitiveFields } from "@openmantis/common/config/sensitive";
import type { WebServerContext } from "../types";
import { err, ok } from "../types";

const resetBodySchema = z.object({
	keys: z.array(z.string().min(1).max(64)).optional(),
});

const testProviderBodySchema = z.object({
	provider: z.string().min(1),
	apiKey: z.string().optional(),
	model: z.string().min(1),
	baseUrl: z
		.string()
		.url()
		.optional()
		.or(z.literal("")),
});

export function configRoutes(ctx: WebServerContext) {
	const app = new Hono();

	// GET /api/config — masked config
	app.get("/", (c) => {
		const config = ctx.configStore.get();
		return c.json(ok(maskSensitiveFields(config as any)));
	});

	// GET /api/config/raw — user-configured values only (behind auth)
	app.get("/raw", (c) => {
		return c.json(ok(ctx.configStore.getRawData()));
	});

	// PUT /api/config — partial update
	app.put("/", async (c) => {
		let partial: Record<string, unknown>;
		try {
			partial = await c.req.json();
		} catch {
			return c.json(err("Invalid JSON body"), 400);
		}
		if (typeof partial !== "object" || partial === null || Array.isArray(partial)) {
			return c.json(err("Request body must be a JSON object"), 400);
		}
		const result = await ctx.configStore.update(partial);
		if (!result.success) {
			return c.json(err(result.error!), 400);
		}
		return c.json(ok({ updated: true, restartRequired: result.changed === true }));
	});

	// POST /api/config/reset
	app.post("/reset", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			body = {};
		}
		const parsed = resetBodySchema.safeParse(body);
		if (!parsed.success) {
			return c.json(err(parsed.error.message), 400);
		}
		const keys = parsed.data.keys;
		const mutated = await ctx.configStore.reset(keys);
		return c.json(ok({ reset: true, keys: keys ?? "all", restartRequired: mutated }));
	});

	// POST /api/config/test-provider — test LLM connection
	app.post("/test-provider", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json(err("Invalid JSON body"), 400);
		}
		const parsed = testProviderBodySchema.safeParse(body);
		if (!parsed.success) {
			return c.json(err(parsed.error.message), 400);
		}
		const { provider, apiKey, model, baseUrl } = parsed.data;
		try {
			const { createLanguageModel } = await import("@openmantis/core/agent/providers");
			const modelConfig = {
				id: model,
				reasoningEffort: "auto" as const,
			};
			const testProviderConfig = {
				name: "__test__",
				provider,
				apiKey,
				models: [modelConfig],
				baseUrl: baseUrl || "",
			};
			const lm = await createLanguageModel(testProviderConfig, modelConfig);
			const { generateText } = await import("ai");
			await generateText({ model: lm, prompt: "Hi", maxOutputTokens: 1 });
			return c.json(ok({ connected: true }));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json(ok({ connected: false, error: message }));
		}
	});

	// GET /api/config/schema — JSON Schema for frontend form
	app.get("/schema", (c) => {
		const jsonSchema = toJSONSchema(configSchema, { unrepresentable: "any" });
		return c.json(ok(jsonSchema));
	});

	// GET /api/config/has-config — check if config.json has content
	app.get("/has-config", (c) => {
		return c.json(ok({ hasConfig: ctx.configStore.hasConfig() }));
	});

	// GET /api/config/restart-required — process-memory flag
	app.get("/restart-required", (c) => {
		return c.json(ok({ restartRequired: ctx.configStore.isRestartRequired() }));
	});

	return app;
}
