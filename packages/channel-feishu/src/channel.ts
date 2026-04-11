import * as Lark from "@larksuiteoapi/node-sdk";
import type { FileAttachment, OnMessageCallback, OutgoingMessage } from "@openmantis/common/types/channels";
import { createLogger } from "@openmantis/common/logger";
import { downloadAttachments } from "./attachments";
import { buildInteractiveCard, buildReplyCard, type InteractiveAction } from "./cards";
import { getBotOpenId, setBotOpenId, setFeishuClient } from "./context";
import { buildFeishuRouteId, parseFeishuContent, stripMention } from "./parser";
import { streamReply, type StreamEvent } from "./stream";
import type { FeishuConfig, Mention } from "./types";

const logger = createLogger("channel-feishu");

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
	metadata?: Record<string, unknown>;
}

export type CommandResult =
	| { type: "display"; text: string }
	| { type: "forward"; content: string }
	| { type: "silent" }
	| { type: "interactive"; title?: string; text: string; actions: InteractiveAction[] };

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

// ─── FeishuChannel ───────────────────────────────────────────────────────────

export class FeishuChannel {
	type: string;
	private config: FeishuConfig;
	private client: Lark.Client;
	private wsClient: Lark.WSClient | null = null;
	private dedup = new MessageDeduplicator();
	private commandRouter: CommandRouterLike | null = null;
	private channelBindings: ChannelBindingsLike;
	private onMessage: OnMessageCallback<StreamEvent> | null = null;
	abortInflight?: (routeId: string) => boolean;

	constructor(
		config: FeishuConfig,
		channelBindings: ChannelBindingsLike,
		opts?: { abortInflight?: (routeId: string) => boolean },
	) {
		this.type = `feishu:${config.name}`;
		this.config = config;
		this.channelBindings = channelBindings;
		this.abortInflight = opts?.abortInflight;
		this.client = new Lark.Client({
			appId: config.appId,
			appSecret: config.appSecret,
		});
		setFeishuClient(config.name, this.client);
	}

	setCommandRouter(router: CommandRouterLike): void {
		this.commandRouter = router;
	}

	getRouteId(chatId: string): string {
		let routeId = this.channelBindings.get(this.type, chatId);
		if (!routeId) {
			routeId = buildFeishuRouteId(this.type, chatId);
			this.channelBindings.set(this.type, chatId, routeId);
		}
		return routeId;
	}

	async init(onMessage: OnMessageCallback<StreamEvent>): Promise<void> {
		this.onMessage = onMessage;

		const eventDispatcher = new Lark.EventDispatcher({}).register({
			"im.message.receive_v1": async (data) => {
				await this.handleEvent(data, onMessage);
			},
			"card.action.trigger": async (data: any) => {
				return this.handleCardAction(data);
			},
		});

		this.wsClient = new Lark.WSClient({
			appId: this.config.appId,
			appSecret: this.config.appSecret,
			loggerLevel: Lark.LoggerLevel.info,
		});

		await this.wsClient.start({ eventDispatcher });
		logger.info(`Feishu channel [${this.config.name}] connected via WebSocket long connection`);

		// Fetch bot's own open_id for accurate @mention filtering in group chats
		try {
			const res = await this.client.request({
				method: "GET",
				url: "https://open.feishu.cn/open-apis/bot/v3/info/",
			});
			const openId = (res as any)?.bot?.open_id;
			if (openId) {
				setBotOpenId(this.config.name, openId);
				logger.info(`Feishu channel [${this.config.name}] bot open_id: ${openId}`);
			}
		} catch (err) {
			logger.warn(`[feishu] failed to fetch bot info, @mention filter may be inaccurate:`, err);
		}
	}

	async run(): Promise<void> {}

	async stop(): Promise<void> {
		this.wsClient = null;
		logger.info(`Feishu channel [${this.config.name}] stopped`);
	}

	async pushMessage(channelId: string, content: string): Promise<void> {
		const prefix = `${this.type}-`;
		const chatId = channelId.startsWith(prefix)
			? channelId.slice(prefix.length)
			: channelId.replace(/^feishu-/, "");
		await this.reply(chatId, content);
	}

	private async handleEvent(data: any, onMessage: OnMessageCallback<StreamEvent>): Promise<void> {
		const message = data?.message;
		if (!message) return;

		const messageId = message.message_id;
		if (this.dedup.isDuplicate(messageId)) {
			logger.debug(`Feishu: skipping duplicate message ${messageId}`);
			return;
		}

		const chatId = message.chat_id;
		const chatType = message.chat_type;
		const messageType = message.message_type;
		const content = message.content ?? "";
		const rawMentions: any[] = message.mentions ?? [];
		const mentions: Mention[] = rawMentions.map((m: any) => ({
			key: m.key,
			name: m.name,
		}));

		// Extract sender info for @mention support
		const sender = data?.sender;
		const senderOpenId = sender?.sender_id?.open_id as string | undefined;

		// In group chats, only respond if this bot is @mentioned
		if (chatType === "group") {
			const botOpenId = getBotOpenId(this.type);
			if (botOpenId) {
				const isBotMentioned = rawMentions.some(
					(m: any) => m.id?.open_id === botOpenId,
				);
				if (!isBotMentioned) return;
			} else {
				// Fallback: respond if any mention exists (old behavior)
				if (rawMentions.length === 0) return;
			}
		}

		const parsed = parseFeishuContent(messageType, content);
		let textContent = parsed.text;

		// Strip @mention tags from text
		if (mentions.length > 0) {
			textContent = stripMention(textContent, mentions);
		}

		// For attachment-only messages, allow empty text; for others require text
		if (!textContent && parsed.attachments.length === 0) return;

		const channelId = `${this.type}-${chatId}`;
		logger.debug(
			`[feishu] incoming message: chatId=${chatId}, chatType=${chatType}, messageType=${messageType}, contentLen=${textContent.length}, attachments=${parsed.attachments.length}`,
		);

		if (textContent.startsWith("/") && this.commandRouter) {
			logger.debug(`[feishu] routing to command: ${textContent.split(/\s+/)[0]}`);
			this.executeCommand(textContent, chatId, channelId, onMessage, senderOpenId);
			return;
		}

		const routeId = this.getRouteId(chatId);
		logger.debug(`[feishu] routing to agent: routeId=${routeId}`);

		// Download attachments then forward to agent
		const attachmentTypeLabel =
			parsed.attachments[0]?.resourceType === "image" ? "[image]" : "[attachment]";
		const senderMeta = { senderOpenId };
		downloadAttachments(this.client, messageId, parsed.attachments)
			.then((files) => {
				const fallbackText = textContent || (files.length > 0 ? "" : attachmentTypeLabel);
				this.sendToAgent(
					chatId,
					channelId,
					routeId,
					fallbackText,
					onMessage,
					files.length > 0 ? files : undefined,
					senderMeta,
				);
			})
			.catch((err) => {
				logger.warn(`[feishu] failed to download attachments, sending text only:`, err);
				this.sendToAgent(
					chatId,
					channelId,
					routeId,
					textContent || attachmentTypeLabel,
					onMessage,
					undefined,
					senderMeta,
				);
			});
	}

	private executeCommand(
		input: string,
		chatId: string,
		channelId: string,
		onMessage: OnMessageCallback<StreamEvent>,
		senderOpenId?: string,
	): void {
		if (!this.commandRouter) return;

		const sendToAgent = async (content: string): Promise<OutgoingMessage> => {
			const { response } = await onMessage({
				channelType: this.type,
				channelId,
				routeId: this.getRouteId(chatId),
				content,
				metadata: { receivedAt: Date.now() },
			});
			return response;
		};

		const call: CallContext = {
			channelType: this.type,
			channelId,
			currentRouteId: this.getRouteId(chatId),
			newRouteId: () => `${this.type}-${chatId}-${Date.now()}`,
			switchRoute: (newId) => this.channelBindings.set(this.type, chatId, newId),
			sendToAgent,
			metadata: {
				...(senderOpenId ? { senderOpenId } : {}),
				botOpenId: getBotOpenId(this.type) ?? undefined,
			},
		};

		this.commandRouter
			.execute(input, call)
			.then(async (result) => {
				switch (result.type) {
					case "display":
						await this.reply(chatId, result.text);
						break;
					case "interactive":
						await this.replyInteractive(chatId, result.text, result.actions, result.title);
						break;
					case "forward": {
						const response = await sendToAgent(result.content);
						await this.reply(chatId, response.content);
						break;
					}
					case "silent":
						break;
				}
			})
			.catch((err) => {
				logger.error("[feishu] failed to execute command", err);
				this.reply(chatId, "Sorry, an error occurred while executing the command.", true).catch(
					(replyErr) => logger.error("[feishu] failed to send error reply", replyErr),
				);
			});
	}

	private sendToAgent(
		chatId: string,
		channelId: string,
		routeId: string,
		content: string,
		onMessage: OnMessageCallback<StreamEvent>,
		files?: FileAttachment[],
		senderMeta?: { senderOpenId?: string },
	): void {
		const doHandle = async () => {
			const { stream, response } = await onMessage({
				channelType: this.type,
				channelId,
				routeId,
				content,
				files: files?.length ? files : undefined,
				metadata: {
					receivedAt: Date.now(),
					...(senderMeta?.senderOpenId ? { senderOpenId: senderMeta.senderOpenId } : {}),
				},
			});

			try {
				await streamReply(this.client, chatId, stream, routeId);
			} catch (streamErr) {
				logger.warn(
					`[feishu] streaming failed, falling back to static reply: ${formatError(streamErr)}`,
				);
				const result = await response;
				await this.reply(chatId, result.content);
				return;
			}

			try {
				await response;
			} catch (e) {
				logger.warn(`[feishu] post-stream finalization failed: ${formatError(e)}`);
			}
		};

		doHandle().catch(async (err) => {
			logger.error(`[feishu] failed to handle message: ${formatError(err)}`);
			this.reply(chatId, "Sorry, an error occurred while processing your message.", true).catch(
				(replyErr) => logger.error("[feishu] failed to send error reply", replyErr),
			);
		});
	}

	private async handleCardAction(data: any): Promise<Record<string, unknown>> {
		const action = data?.action;
		const value = action?.value;
		const chatId = data?.context?.open_chat_id;

		if (!value || !chatId || !this.onMessage || !this.commandRouter) {
			return {};
		}

		if (value.action === "stop") {
			const routeId = value.routeId as string | undefined;
			logger.info(`[feishu] stop button clicked: routeId=${routeId}`);
			const ok = routeId && this.abortInflight ? this.abortInflight(routeId) : false;
			logger.info(`[feishu] stop button result: routeId=${routeId}, aborted=${ok}`);
			return {
				toast: {
					type: ok ? "info" : "warning",
					content: ok ? "已请求终止" : "当前没有进行中的对话",
				},
			};
		}

		if (typeof value.command !== "string") return {};

		// Generic command dispatch: reconstruct slash command from button value
		const args = Object.entries(value)
			.filter(([key, val]) => key !== "command" && typeof val === "string")
			.map(([, val]) => val);
		const cmd = `/${value.command}${args.length ? ` ${args.join(" ")}` : ""}`;
		const call = this.buildCallContext(chatId);

		try {
			const result = await this.commandRouter.execute(cmd, call);
			switch (result.type) {
				case "interactive":
					return {
						card: JSON.parse(
							buildInteractiveCard(result.title ?? "Actions", result.actions),
						),
					};
				case "display":
					return {
						toast: { type: "success", content: result.text },
					};
				case "forward":
					this.sendToAgent(
						chatId,
						call.channelId,
						this.getRouteId(chatId),
						result.content,
						this.onMessage!,
					);
					return {
						toast: { type: "info", content: "正在处理..." },
					};
				default:
					return {};
			}
		} catch (err) {
			logger.error("[feishu] failed to execute card action command", err);
			return {
				toast: { type: "error", content: "操作失败，请重试。" },
			};
		}
	}

	private buildCallContext(chatId: string): CallContext {
		const channelId = `${this.type}-${chatId}`;
		return {
			channelType: this.type,
			channelId,
			currentRouteId: this.getRouteId(chatId),
			newRouteId: () => `${this.type}-${chatId}-${Date.now()}`,
			switchRoute: (newId) => this.channelBindings.set(this.type, chatId, newId),
			sendToAgent: async (content: string) => {
				const { response } = await this.onMessage!({
					channelType: this.type,
					channelId,
					routeId: this.getRouteId(chatId),
					content,
					metadata: { receivedAt: Date.now() },
				});
				return response;
			},
		};
	}

	private async replyInteractive(
		chatId: string,
		_fallbackText: string,
		actions: InteractiveAction[],
		title = "Routes",
	): Promise<void> {
		const card = buildInteractiveCard(title, actions);
		await this.client.im.v1.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: chatId,
				content: card,
				msg_type: "interactive",
			},
		});
	}

	private async reply(chatId: string, content: string, isError = false): Promise<void> {
		await this.client.im.v1.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: chatId,
				content: buildReplyCard(content, isError),
				msg_type: "interactive",
			},
		});
	}
}

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
