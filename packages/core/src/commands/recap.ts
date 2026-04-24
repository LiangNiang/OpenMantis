import { createLogger } from "@openmantis/common/logger";
import { archiveRouteWithRecap } from "../recap/summarizer";
import type { RecapEntry, RecapResult } from "../recap/types";
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

		let entry: RecapEntry;
		try {
			entry = await archiveRouteWithRecap({
				route,
				config: ctx.config,
				routeStore: ctx.routeStore,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.warn(`[recap] generation failed for route=${ctx.currentRouteId}: ${message}`);
			return { type: "display", text: `生成 recap 失败：${message}` };
		}

		return { type: "display", text: renderRecap(entry.result) };
	},
};
