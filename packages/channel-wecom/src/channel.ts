import type { BaseMessage, WsFrame, WsFrameHeaders } from "@wecom/aibot-node-sdk";
import { WSAuthFailureError, WSClient, WSReconnectExhaustedError } from "@wecom/aibot-node-sdk";
import type { FileAttachment, OnMessageCallback, OutgoingMessage } from "@openmantis/common/types/channels";
import { createLogger } from "@openmantis/common/logger";
import { setWecomClient } from "./context";
import { downloadWeComAttachments } from "./attachments";
import { buildWeComRouteId, parseWeComMessage, stripAtMention } from "./parser";
import { streamWeComResponse, type StreamEvent } from "./stream";
import type { WeComConfig } from "./types";

const logger = createLogger("channel-wecom");

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

// ─── WeComChannel ─────────────────────────────────────────────────────────────

export class WeComChannel {
	type = "wecom";
	private config: WeComConfig;
	private client: WSClient | null = null;
	private dedup = new MessageDeduplicator();
	private commandRouter: CommandRouterLike | null = null;
	private channelBindings: ChannelBindingsLike;
	private onMessage: OnMessageCallback<StreamEvent> | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectAttempt = 0;
	private stopping = false;

	constructor(config: WeComConfig, channelBindings: ChannelBindingsLike) {
		this.config = config;
		this.channelBindings = channelBindings;
	}

	setCommandRouter(router: CommandRouterLike): void {
		this.commandRouter = router;
	}

	getRouteId(chatId: string): string {
		let routeId = this.channelBindings.get("wecom", chatId);
		if (!routeId) {
			routeId = buildWeComRouteId(chatId);
			this.channelBindings.set("wecom", chatId, routeId);
		}
		return routeId;
	}

	async init(onMessage: OnMessageCallback<StreamEvent>): Promise<void> {
		this.onMessage = onMessage;
		this.createClient();
		setWecomClient(this.client!);
	}

	async run(): Promise<void> {
		this.client!.connect();
	}

	private createClient(): void {
		this.client = new WSClient({
			botId: this.config.botId,
			secret: this.config.secret,
		});

		this.client.on("message", (frame: WsFrame<BaseMessage>) => {
			this.handleMsgCallback(frame);
		});

		this.client.on("authenticated", () => {
			logger.info("[wecom] connected via WebSocket");
			this.reconnectAttempt = 0;
		});

		// disconnected_event (server kick): SDK won't auto-reconnect, we must
		this.client.on("event.disconnected_event", () => {
			logger.warn("[wecom] server kicked this connection (disconnected_event)");
			this.scheduleReconnect();
		});

		// SDK reconnect exhausted or auth failure exhausted: we take over
		this.client.on("error", (err: Error) => {
			if (err instanceof WSReconnectExhaustedError || err instanceof WSAuthFailureError) {
				logger.warn("[wecom] SDK reconnect gave up:", err.message);
				this.scheduleReconnect();
			}
		});

		this.client.on("disconnected", (reason: string) => {
			logger.warn("[wecom] disconnected:", reason);
		});
	}

	async stop(): Promise<void> {
		this.stopping = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.client?.disconnect();
		this.client = null;
		logger.info("WeCom channel stopped");
	}

	private scheduleReconnect(): void {
		if (this.stopping || this.reconnectTimer) return;
		const delays = [1000, 2000, 5000, 10000, 30000, 60000];
		const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)];
		this.reconnectAttempt++;
		logger.info(`[wecom] will reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (this.stopping) return;
			logger.info("[wecom] reconnecting with new client...");
			if (this.client) {
				this.client.removeAllListeners();
				this.client.disconnect();
			}
			this.createClient();
			this.client!.connect();
		}, delay);
	}

	async pushMessage(channelId: string, content: string): Promise<void> {
		if (!this.client) {
			logger.warn("[wecom] cannot push message: client not connected");
			return;
		}
		const chatId = channelId.replace(/^wecom-/, "");
		await this.client.sendMessage(chatId, {
			msgtype: "markdown",
			markdown: { content },
		});
	}

	private async handleMsgCallback(frame: WsFrame<BaseMessage>): Promise<void> {
		const msg = frame.body;
		if (!msg) return;

		const messageId = msg.msgid;
		if (this.dedup.isDuplicate(messageId)) {
			logger.debug(`[wecom] skipping duplicate message ${messageId}`);
			return;
		}

		const chatId = msg.chatid ?? msg.from.userid;
		const chatType = msg.chattype;
		const frameHeaders: WsFrameHeaders = { headers: frame.headers };

		const parsed = parseWeComMessage(msg);
		let textContent = parsed.text;

		// In group chats, strip @mention prefix
		if (chatType === "group") {
			textContent = stripAtMention(textContent);
		}

		// For attachment-only messages, allow empty text; for others require text
		if (!textContent && parsed.attachments.length === 0) return;

		const channelId = `wecom-${chatId}`;
		logger.debug(
			`[wecom] incoming message: chatId=${chatId}, chatType=${chatType}, msgtype=${msg.msgtype}, contentLen=${textContent.length}, attachments=${parsed.attachments.length}`,
		);

		if (textContent.startsWith("/") && this.commandRouter) {
			logger.debug(`[wecom] routing to command: ${textContent.split(/\s+/)[0]}`);
			executeCommand(textContent, {
				channelType: this.type,
				channelId,
				getRouteId: () => this.getRouteId(chatId),
				newRouteId: () => buildWeComRouteId(chatId),
				switchRoute: (newId) => this.channelBindings.set("wecom", chatId, newId),
				onMessage: this.onMessage!,
				commandRouter: this.commandRouter,
				reply: (text) => this.replyText(frameHeaders, text),
				logPrefix: "[wecom]",
			});
			return;
		}

		const routeId = this.getRouteId(chatId);
		logger.debug(`[wecom] routing to agent: routeId=${routeId}`);

		// Download attachments then forward to agent
		const attachmentTypeLabel =
			parsed.attachments[0]?.resourceType === "image" ? "[image]" : "[attachment]";
		downloadWeComAttachments(this.client!, parsed.attachments)
			.then((files) => {
				const fallbackText = textContent || (files.length > 0 ? "" : attachmentTypeLabel);
				this.sendToAgent(
					channelId,
					routeId,
					fallbackText,
					frameHeaders,
					files.length > 0 ? files : undefined,
				);
			})
			.catch((err) => {
				logger.warn("[wecom] failed to download attachments, sending text only:", err);
				this.sendToAgent(channelId, routeId, textContent || attachmentTypeLabel, frameHeaders);
			});
	}

	private sendToAgent(
		channelId: string,
		routeId: string,
		content: string,
		frame: WsFrameHeaders,
		files?: FileAttachment[],
	): void {
		handleAgentMessage({
			channelType: this.type,
			channelId,
			routeId,
			content,
			files,
			onMessage: this.onMessage!,
			streamReply: async (stream) => {
				return await streamWeComResponse(this.client!, frame, stream);
			},
			fallbackReply: (text) => this.replyText(frame, text),
			errorReply: (text) => this.replyText(frame, text),
			logPrefix: "[wecom]",
		});
	}

	private async replyText(frame: WsFrameHeaders, text: string): Promise<void> {
		await this.client!.reply(frame, {
			msgtype: "markdown",
			markdown: { content: text },
		});
	}
}
