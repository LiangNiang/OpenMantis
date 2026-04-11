import type { CommandContext, CommandDefinition, CommandResult } from "./types";

export const voiceCommand: CommandDefinition = {
	name: "voice",
	description: "Toggle TTS voice mode for current route (Feishu/WeCom only)",
	usage: "/voice [on|off]",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		const route = await ctx.routeStore.get(ctx.currentRouteId);
		if (!route) {
			return { type: "display", text: "No active route." };
		}

		const arg = ctx.args[0];

		if (!arg) {
			const status = route.voiceMode ? "on" : "off";
			return { type: "display", text: `Voice mode: ${status}` };
		}

		if (arg === "on") {
			route.voiceMode = true;
			await ctx.routeStore.save(route);
			return { type: "display", text: "Voice mode: on" };
		}

		if (arg === "off") {
			route.voiceMode = false;
			await ctx.routeStore.save(route);
			return { type: "display", text: "Voice mode: off" };
		}

		return { type: "display", text: "Usage: /voice [on|off]" };
	},
};
