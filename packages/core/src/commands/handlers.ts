import { createLogger } from "@openmantis/common/logger";
import type { CommandRouter } from "./router";
import type { CommandContext, CommandDefinition, CommandResult } from "./types";

const logger = createLogger("core/commands");

export function helpCommand(router: CommandRouter): CommandDefinition {
	return {
		name: "help",
		description: "Show available commands",
		usage: "/help",
		type: "local",
		async execute(): Promise<CommandResult> {
			const lines = router.list().map((cmd) => `  ${cmd.usage.padEnd(30)} ${cmd.description}`);
			return {
				type: "display",
				text: `Available commands:\n${lines.join("\n")}`,
			};
		},
	};
}

export const newCommand: CommandDefinition = {
	name: "new",
	description: "Start a new route",
	usage: "/new",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		const newId = ctx.newRouteId();
		await ctx.routeStore.create(newId, ctx.channelType, ctx.channelId);
		ctx.switchRoute(newId);
		return { type: "display", text: `New route started: ${newId}` };
	},
};

export const clearCommand: CommandDefinition = {
	name: "clear",
	description: "Clear current route messages",
	usage: "/clear",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		const route = await ctx.routeStore.get(ctx.currentRouteId);
		if (route) {
			route.messages = [];
			await ctx.routeStore.save(route);
		}
		return { type: "display", text: "Route messages cleared." };
	},
};

export const stopCommand: CommandDefinition = {
	name: "stop",
	description: "Force-stop the in-flight conversation on the current route",
	usage: "/stop",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		const ok = ctx.abortInflight(ctx.currentRouteId);
		logger.info(
			`[command] /stop on route=${ctx.currentRouteId} channel=${ctx.channelType}/${ctx.channelId}: ${ok ? "aborted" : "no inflight"}`,
		);
		// On success, the in-flight stream itself will surface "⏹ 已停止" feedback
		// (text marker in CLI/WeCom/QQ, disabled stopped card in Feishu) — no
		// extra chat reply needed. Only respond visibly when there was nothing to stop.
		if (ok) return { type: "silent" };
		return { type: "display", text: "当前没有进行中的对话" };
	},
};

export const deleteCommand: CommandDefinition = {
	name: "delete",
	description: "Delete a route",
	usage: "/delete [id]",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		const target = ctx.args[0] ?? ctx.currentRouteId;

		await ctx.routeStore.delete(target);
		await ctx.channelBindings.deleteByRouteId(target);

		const isCurrentRoute = target === ctx.currentRouteId;
		if (isCurrentRoute) {
			const newId = ctx.newRouteId();
			ctx.switchRoute(newId);
			return {
				type: "display",
				text: `Route "${target}" deleted. Switched to new route: ${newId}`,
			};
		}

		return { type: "display", text: `Route "${target}" deleted.` };
	},
};

export const listCommand: CommandDefinition = {
	name: "list",
	description: "List all routes",
	usage: "/list",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		const routes = await ctx.routeStore.list();

		if (routes.length === 0) {
			return { type: "display", text: "No routes found." };
		}

		const sorted = routes.sort((a, b) => b.createdAt - a.createdAt);

		const lines = sorted.map((r) => {
			const marker = r.id === ctx.currentRouteId ? " *" : "";
			const time = new Date(r.createdAt).toLocaleString();
			const model = r.modelId ? ` model: ${r.modelId},` : "";
			return `  ${r.id}${marker} [${model} ${r.messageCount} msgs, ${time}]`;
		});

		const text = `Routes:\n${lines.join("\n")}`;

		const actions = sorted.map((r) => {
			const isCurrent = r.id === ctx.currentRouteId;
			const name = r.id.slice(0, 16);
			const time = new Date(r.createdAt).toLocaleString();
			return {
				label: isCurrent ? `${name} ✦` : name,
				description: `${time} · ${r.messageCount} msgs`,
				value: { command: "resume", routeId: r.id },
				disabled: isCurrent,
				buttonType: isCurrent ? ("default" as const) : ("primary" as const),
				disabledTips: isCurrent ? "当前会话" : undefined,
			};
		});
		return { type: "interactive", title: "Routes", text, actions };
	},
};

export const historyCommand: CommandDefinition = {
	name: "history",
	description: "Show current route messages",
	usage: "/history",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		const route = await ctx.routeStore.get(ctx.currentRouteId);
		if (!route || route.messages.length === 0) {
			return { type: "display", text: "No messages in current route." };
		}

		const lines = route.messages.map((msg) => {
			const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
			const truncated = content.length > 200 ? `${content.slice(0, 200)}...` : content;
			return `  [${msg.role}] ${truncated}`;
		});

		return {
			type: "display",
			text: `History (${route.messages.length} messages):\n${lines.join("\n")}`,
		};
	},
};

export const channelCommand: CommandDefinition = {
	name: "channel",
	description: "Show current channel type and ID",
	usage: "/channel",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		return {
			type: "display",
			text: `Channel: ${ctx.channelType} / ${ctx.channelId}`,
		};
	},
};

export const resumeCommand: CommandDefinition = {
	name: "resume",
	description: "Resume a previous route",
	usage: "/resume <id>",
	type: "hybrid",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		const target = ctx.args[0];
		if (!target) {
			return { type: "display", text: "Usage: /resume <id>" };
		}

		const route = await ctx.routeStore.get(target);
		if (!route) {
			return { type: "display", text: `Route "${target}" not found.` };
		}

		ctx.switchRoute(route.id);
		return { type: "display", text: `Resumed route: ${route.id}` };
	},
};

export const botOpenIdCommand: CommandDefinition = {
	name: "bot-open-id",
	description: "Show bot open_id (Feishu only)",
	usage: "/bot-open-id",
	type: "local",
	async execute(ctx: CommandContext): Promise<CommandResult> {
		if (!ctx.channelType.startsWith("feishu")) {
			return { type: "display", text: "此命令仅在飞书渠道可用" };
		}
		const openId = ctx.metadata?.botOpenId as string | undefined;
		return {
			type: "display",
			text: openId ? `bot_open_id: \`${openId}\`` : "bot_open_id 尚未获取",
		};
	},
};
