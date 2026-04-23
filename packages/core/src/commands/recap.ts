import { createLogger } from "@openmantis/common/logger";
import { generateRecap } from "../recap/summarizer";
import type { GenerateRecapOutput, RecapEntry, RecapResult } from "../recap/types";
import type { CommandContext, CommandDefinition, CommandResult } from "./types";

const logger = createLogger("core/recap");

function renderRecap(result: RecapResult): string {
	return [
		`📋 ${result.heading}`,
		"",
		"**目标**",
		result.sections.goal,
		"",
		"**关键决策**",
		result.sections.decisions,
		"",
		"**主要改动**",
		result.sections.changes,
		"",
		"**待办 / 未决**",
		result.sections.todos,
	].join("\n");
}

export const recapCommand: CommandDefinition = {
	name: "recap",
	description: "Summarize current route into a structured recap",
	usage: "/recap",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		const route = await ctx.routeStore.get(ctx.currentRouteId);
		if (!route) {
			return { type: "display", text: "会话未找到" };
		}

		let output: GenerateRecapOutput;
		try {
			output = await generateRecap({ route, config: ctx.config });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.warn(`[recap] generation failed for route=${ctx.currentRouteId}: ${message}`);
			return { type: "display", text: `生成 recap 失败：${message}` };
		}

		const entry: RecapEntry = {
			id: crypto.randomUUID().slice(0, 8),
			createdAt: Date.now(),
			messageCount: route.messages.length,
			provider: output.provider,
			modelId: output.modelId,
			result: output.result,
		};

		route.recaps = [...(route.recaps ?? []), entry];

		try {
			await ctx.routeStore.save(route);
		} catch (err) {
			logger.warn("[recap] save route failed (non-fatal):", err);
		}

		return { type: "display", text: renderRecap(output.result) };
	},
};
