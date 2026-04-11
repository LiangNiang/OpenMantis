import type { OpenMantisConfig } from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import type { OutgoingMessage } from "../channels/types";
import type { ChannelBindings } from "../gateway/channel-bindings";
import type { RouteStore } from "../gateway/route-store";

const logger = createLogger("core/commands");

import type { CommandContext, CommandDefinition, CommandResult } from "./types";

interface ParsedCommand {
	name: string;
	args: string[];
	rawArgs: string;
}

function parseCommand(input: string): ParsedCommand {
	const trimmed = input.trim();
	const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
	const parts = withoutSlash.split(/\s+/);
	const name = parts[0] ?? "";
	const args = parts.slice(1);
	const rawArgs = withoutSlash.slice(name.length).trim();
	return { name, args, rawArgs };
}

export interface CommandRouterDeps {
	routeStore: RouteStore;
	channelBindings: ChannelBindings;
	config: OpenMantisConfig;
	abortInflight: (routeId: string) => boolean;
}

export interface CallContext {
	channelType: string;
	channelId: string;
	currentRouteId: string;
	newRouteId: () => string;
	switchRoute: (id: string) => void;
	sendToAgent: (content: string) => Promise<OutgoingMessage>;
	metadata?: Record<string, unknown>;
}

export class CommandRouter {
	private deps: CommandRouterDeps;
	private commands = new Map<string, CommandDefinition>();

	constructor(deps: CommandRouterDeps) {
		this.deps = deps;
	}

	register(cmd: CommandDefinition): void {
		this.commands.set(cmd.name, cmd);
	}

	list(): CommandDefinition[] {
		return Array.from(this.commands.values());
	}

	async execute(input: string, call: CallContext): Promise<CommandResult> {
		const parsed = parseCommand(input);
		const cmd = this.commands.get(parsed.name);

		if (!cmd) {
			logger.warn(`[command] unknown command: /${parsed.name}`);
			return {
				type: "display",
				text: `Unknown command: /${parsed.name}. Type /help for available commands.`,
			};
		}

		logger.debug(
			`[command] executing /${parsed.name}${parsed.rawArgs ? ` ${parsed.rawArgs}` : ""} on route=${call.currentRouteId}`,
		);

		const ctx: CommandContext = {
			args: parsed.args,
			rawArgs: parsed.rawArgs,
			channelType: call.channelType,
			channelId: call.channelId,
			currentRouteId: call.currentRouteId,
			newRouteId: call.newRouteId,
			routeStore: this.deps.routeStore,
			channelBindings: this.deps.channelBindings,
			config: this.deps.config,
			switchRoute: call.switchRoute,
			sendToAgent: call.sendToAgent,
			abortInflight: this.deps.abortInflight,
			metadata: call.metadata,
		};

		const result = await cmd.execute(ctx);
		logger.debug(`[command] /${parsed.name} completed: type=${result.type}`);
		return result;
	}
}
