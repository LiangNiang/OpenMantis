import type { FileAttachment, OnMessageCallback, OutgoingMessage } from "@openmantis/common/types/channels";
import { createLogger } from "@openmantis/common/logger";
import { downloadQQAttachments } from "./attachments";
import { QQApi } from "./api";
import { QQGateway } from "./gateway";
import { buildQQChannelId, buildQQRouteId, parseQQMessage, stripQQMention } from "./parser";
import { streamQQReply, type StreamEvent } from "./stream";
import type { QQConfig } from "./types";

const logger = createLogger("channel-qq");

// ─── Structural interfaces (replaces core imports) ───────────────────────────

export interface ChannelBindingsLike {
	get(channelType: string, chatId: string): string | undefined;
	set(channelType: string, chatId: string, routeId: string): void;
}

export interface CallContext {
	channelType: string;
	channelId: string;
	currentRouteId: string;
	newRouteId: () => string;
	switchRoute: (id: string) => void;
	sendToAgent: (content: string) => Promise<OutgoingMessage>;
}

export type CommandResult =
	| { type: "display"; text: string }
	| { type: "forward"; content: string }
	| { type: "silent" }
	| { type: "interactive"; title?: string; text: string; actions: never[] };

export interface CommandRouterLike {
	execute(input: string, ctx: CallContext): Promise<CommandResult>;
}

// ─── Message deduplicator ────────────────────────────────────────────────────

class MessageDeduplicator {
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

// ─── Inlined helpers ─────────────────────────────────────────────────────────

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

interface ChannelCommandContext {
	channelType: string;
	channelId: string;
	getRouteId: () => string;
	newRouteId: () => string;
	switchRoute: (id: string) => void;
	onMessage: OnMessageCallback<StreamEvent>;
	commandRouter: CommandRouterLike;
	reply: (text: string) => Promise<void>;
	logPrefix: string;
}

async function executeCommand(input: string, ctx: ChannelCommandContext): Promise<void> {
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
				await ctx.reply(result.text);
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
			.reply("Sorry, an error occurred while executing the command.")
			.catch((replyErr) => logger.error(`${ctx.logPrefix} failed to send error reply`, replyErr));
	}
}

interface AgentMessageContext {
	channelType: string;
	channelId: string;
	routeId: string;
	content: string;
	files?: FileAttachment[];
	onMessage: OnMessageCallback<StreamEvent>;
	streamReply: (stream: AsyncIterable<StreamEvent>) => Promise<unknown>;
	fallbackReply: (text: string) => Promise<void>;
	errorReply: (text: string) => Promise<void>;
	logPrefix: string;
}

function handleAgentMessage(ctx: AgentMessageContext): void {
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

// ─── QQChannel ───────────────────────────────────────────────────────────────

export class QQChannel {
	type = "qq";
	private api: QQApi;
	private gateway: QQGateway;
	private dedup = new MessageDeduplicator();
	private commandRouter: CommandRouterLike | null = null;
	private channelBindings: ChannelBindingsLike;
	private onMessage: OnMessageCallback<StreamEvent> | null = null;

	constructor(config: QQConfig, channelBindings: ChannelBindingsLike) {
		this.channelBindings = channelBindings;
		this.api = new QQApi(config);
		this.gateway = new QQGateway(this.api);
	}

	setCommandRouter(router: CommandRouterLike): void {
		this.commandRouter = router;
	}

	private getRouteId(isGroup: boolean, targetId: string): string {
		const chatKey = isGroup ? `group-${targetId}` : `c2c-${targetId}`;
		let routeId = this.channelBindings.get("qq", chatKey);
		if (!routeId) {
			routeId = buildQQRouteId(isGroup, targetId);
			this.channelBindings.set("qq", chatKey, routeId);
		}
		return routeId;
	}

	async init(onMessage: OnMessageCallback<StreamEvent>): Promise<void> {
		this.onMessage = onMessage;
		this.gateway.onEvent((eventType, data) => {
			this.handleEvent(eventType, data);
		});
	}

	async run(): Promise<void> {
		try {
			await this.gateway.start();
		} catch (err) {
			const msg = err instanceof Error ? err.message : JSON.stringify(err) || String(err);
			throw new Error(`[qq] failed to start gateway: ${msg}`);
		}
	}

	async stop(): Promise<void> {
		await this.gateway.stop();
		logger.info("QQ channel stopped");
	}

	async pushMessage(channelId: string, content: string): Promise<void> {
		try {
			if (channelId.startsWith("qq-c2c-")) {
				const openid = channelId.slice("qq-c2c-".length);
				await this.api.sendC2CMessage(openid, {
					msg_type: 0,
					content,
				});
			} else if (channelId.startsWith("qq-group-")) {
				const groupOpenid = channelId.slice("qq-group-".length);
				await this.api.sendGroupMessage(groupOpenid, {
					msg_type: 0,
					content,
				});
			}
		} catch (err) {
			// QQ active message quota is very limited (4/month), log but don't throw
			logger.warn(`[qq] pushMessage failed (quota may be exhausted):`, err);
		}
	}

	private handleEvent(eventType: string, data: any): void {
		if (eventType !== "C2C_MESSAGE_CREATE" && eventType !== "GROUP_AT_MESSAGE_CREATE") {
			return;
		}

		const msgId = data.id;
		if (this.dedup.isDuplicate(msgId)) {
			logger.debug(`[qq] skipping duplicate message ${msgId}`);
			return;
		}

		const isGroup = eventType === "GROUP_AT_MESSAGE_CREATE";
		const parsed = parseQQMessage(eventType, data);

		let textContent = parsed.text;
		if (isGroup) {
			textContent = stripQQMention(textContent);
		}

		const targetId = isGroup ? parsed.groupOpenId! : parsed.userOpenId;
		const channelId = buildQQChannelId(isGroup, targetId);

		if (!textContent && parsed.attachments.length === 0) return;

		logger.debug(
			`[qq] incoming message: type=${eventType}, target=${targetId}, contentLen=${textContent.length}, attachments=${parsed.attachments.length}`,
		);

		if (textContent.startsWith("/") && this.commandRouter) {
			logger.debug(`[qq] routing to command: ${textContent.split(/\s+/)[0]}`);
			executeCommand(textContent, {
				channelType: this.type,
				channelId,
				getRouteId: () => this.getRouteId(isGroup, targetId),
				newRouteId: () => buildQQRouteId(isGroup, targetId),
				switchRoute: (newId) => {
					const chatKey = isGroup ? `group-${targetId}` : `c2c-${targetId}`;
					this.channelBindings.set("qq", chatKey, newId);
				},
				onMessage: this.onMessage!,
				commandRouter: this.commandRouter,
				reply: (text) => this.replyText(isGroup, targetId, parsed.msgId, text),
				logPrefix: "[qq]",
			});
			return;
		}

		const routeId = this.getRouteId(isGroup, targetId);
		logger.debug(`[qq] routing to agent: routeId=${routeId}`);

		const attachmentTypeLabel = parsed.attachments[0]?.contentType?.startsWith("image/")
			? "[image]"
			: "[attachment]";

		downloadQQAttachments(parsed.attachments)
			.then((files) => {
				const fallbackText = textContent || (files.length > 0 ? "" : attachmentTypeLabel);
				this.sendToAgent(
					isGroup,
					targetId,
					channelId,
					routeId,
					parsed.msgId,
					fallbackText,
					files.length > 0 ? files : undefined,
				);
			})
			.catch((err) => {
				logger.warn("[qq] failed to download attachments, sending text only:", err);
				this.sendToAgent(
					isGroup,
					targetId,
					channelId,
					routeId,
					parsed.msgId,
					textContent || attachmentTypeLabel,
				);
			});
	}

	private sendToAgent(
		isGroup: boolean,
		targetId: string,
		channelId: string,
		routeId: string,
		msgId: string,
		content: string,
		files?: FileAttachment[],
	): void {
		handleAgentMessage({
			channelType: this.type,
			channelId,
			routeId,
			content,
			files,
			onMessage: this.onMessage!,
			streamReply: isGroup
				? async (stream) => {
						// Group: no native streaming support, consume stream then send one-shot
						let text = "";
						for await (const event of stream) {
							if (event.type === "text-delta") text += event.text;
						}
						await this.replyText(true, targetId, msgId, text || "(empty response)");
					}
				: (stream) => streamQQReply(this.api, targetId, msgId, stream),
			fallbackReply: (text) => this.replyText(isGroup, targetId, msgId, text),
			errorReply: (text) => this.replyText(isGroup, targetId, msgId, text),
			logPrefix: "[qq]",
		});
	}

	private msgSeqCounter = 1;

	private async replyText(
		isGroup: boolean,
		targetId: string,
		msgId: string,
		text: string,
	): Promise<void> {
		const msgSeq = this.msgSeqCounter++;
		if (isGroup) {
			await this.api.sendGroupMessage(targetId, {
				msg_type: 0,
				content: text,
				msg_id: msgId,
				msg_seq: msgSeq,
			});
		} else {
			await this.api.sendC2CMessage(targetId, {
				msg_type: 0,
				content: text,
				msg_id: msgId,
				msg_seq: msgSeq,
			});
		}
	}
}
