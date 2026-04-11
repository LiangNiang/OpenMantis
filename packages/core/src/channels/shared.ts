import { createLogger } from "@openmantis/common/logger";
import type { CallContext, CommandRouter } from "../commands/router";
import type { InteractiveAction } from "../commands/types";
import type { StreamEvent } from "../gateway/stream-events";

const logger = createLogger("core/channels");

import type { FileAttachment, OnMessageCallback, OutgoingMessage } from "./types";

function formatError(err: unknown): string {
	if (err instanceof Error) {
		return err.stack ?? `${err.name}: ${err.message}`;
	}
	try {
		return JSON.stringify(err);
	} catch {
		return String(err);
	}
}

export class MessageDeduplicator {
	private old = new Set<string>();
	private current = new Set<string>();
	private maxSize: number;

	constructor(maxSize = 10000) {
		this.maxSize = maxSize;
	}

	isDuplicate(id: string): boolean {
		if (this.current.has(id) || this.old.has(id)) return true;
		this.current.add(id);
		if (this.current.size >= this.maxSize) {
			this.old = this.current;
			this.current = new Set();
		}
		return false;
	}
}

export interface ChannelCommandContext {
	channelType: string;
	channelId: string;
	getRouteId: () => string;
	newRouteId: () => string;
	switchRoute: (id: string) => void;
	onMessage: OnMessageCallback;
	commandRouter: CommandRouter;
	reply: (text: string, isError?: boolean) => Promise<void>;
	replyInteractive?: (text: string, actions: InteractiveAction[], title?: string) => Promise<void>;
	logPrefix: string;
}

export async function executeCommand(input: string, ctx: ChannelCommandContext): Promise<void> {
	const sendToAgent = async (content: string): Promise<OutgoingMessage> => {
		const { response } = await ctx.onMessage({
			channelType: ctx.channelType,
			channelId: ctx.channelId,
			routeId: ctx.getRouteId(),
			content,
			metadata: { receivedAt: Date.now() },
		});
		return response;
	};

	const call: CallContext = {
		channelType: ctx.channelType,
		channelId: ctx.channelId,
		currentRouteId: ctx.getRouteId(),
		newRouteId: ctx.newRouteId,
		switchRoute: ctx.switchRoute,
		sendToAgent,
	};

	try {
		const result = await ctx.commandRouter.execute(input, call);
		switch (result.type) {
			case "display":
				await ctx.reply(result.text);
				break;
			case "interactive":
				if (ctx.replyInteractive) {
					await ctx.replyInteractive(result.text, result.actions, result.title);
				} else {
					await ctx.reply(result.text);
				}
				break;
			case "forward": {
				const response = await sendToAgent(result.content);
				await ctx.reply(response.content);
				break;
			}
			case "silent":
				break;
		}
	} catch (err) {
		logger.error(`${ctx.logPrefix} failed to execute command`, err);
		ctx
			.reply("Sorry, an error occurred while executing the command.", true)
			.catch((replyErr) => logger.error(`${ctx.logPrefix} failed to send error reply`, replyErr));
	}
}

export interface AgentMessageContext {
	channelType: string;
	channelId: string;
	routeId: string;
	content: string;
	files?: FileAttachment[];
	onMessage: OnMessageCallback;
	streamReply: (stream: AsyncIterable<StreamEvent>) => Promise<unknown>;
	fallbackReply: (text: string) => Promise<void>;
	errorReply: (text: string) => Promise<void>;
	logPrefix: string;
}

export async function handleAgentMessage(ctx: AgentMessageContext): Promise<void> {
	const doHandle = async () => {
		const { stream, response } = await ctx.onMessage({
			channelType: ctx.channelType,
			channelId: ctx.channelId,
			routeId: ctx.routeId,
			content: ctx.content,
			files: ctx.files?.length ? ctx.files : undefined,
			metadata: { receivedAt: Date.now() },
		});

		try {
			await ctx.streamReply(stream);
		} catch (streamErr) {
			logger.warn(
				`${ctx.logPrefix} streaming failed, falling back to static reply: ${formatError(streamErr)}`,
			);
			const result = await response;
			await ctx.fallbackReply(result.content);
			return;
		}

		try {
			await response;
		} catch (e) {
			logger.warn(`${ctx.logPrefix} post-stream finalization failed: ${formatError(e)}`);
		}
	};

	doHandle().catch(async (err) => {
		logger.error(`${ctx.logPrefix} failed to handle message: ${formatError(err)}`);
		ctx
			.errorReply("Sorry, an error occurred while processing your message.")
			.catch((replyErr) =>
				logger.error(`${ctx.logPrefix} failed to send error reply: ${formatError(replyErr)}`),
			);
	});
}
