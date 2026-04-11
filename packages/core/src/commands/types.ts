import type { OpenMantisConfig } from "@openmantis/common/config/schema";
import type { OutgoingMessage } from "../channels/types";
import type { ChannelBindings } from "../gateway/channel-bindings";
import type { RouteStore } from "../gateway/route-store";

export interface CommandDefinition {
	name: string;
	description: string;
	usage: string;
	type: "local" | "agent" | "hybrid";
	execute: (ctx: CommandContext) => Promise<CommandResult>;
}

export interface CommandContext {
	args: string[];
	rawArgs: string;
	channelType: string;
	channelId: string;
	currentRouteId: string;
	newRouteId: () => string;
	routeStore: RouteStore;
	channelBindings: ChannelBindings;
	config: OpenMantisConfig;
	switchRoute: (id: string) => void;
	sendToAgent: (content: string) => Promise<OutgoingMessage>;
	abortInflight: (routeId: string) => boolean;
	metadata?: Record<string, unknown>;
}

export interface InteractiveAction {
	label: string;
	description?: string;
	value: Record<string, string>;
	disabled?: boolean;
	buttonType?:
		| "default"
		| "primary"
		| "danger"
		| "text"
		| "primary_text"
		| "danger_text"
		| "primary_filled"
		| "danger_filled"
		| "laser";
	disabledTips?: string;
}

export type CommandResult =
	| { type: "display"; text: string }
	| { type: "forward"; content: string }
	| { type: "silent" }
	| {
			type: "interactive";
			title?: string;
			text: string;
			actions: InteractiveAction[];
	  };
