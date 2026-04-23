import { getWecomClient } from "@openmantis/channel-wecom";
import {
	isBrowserCdpActive,
	type OpenMantisConfig,
	resolveProvider,
} from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import { ROUTES_DIR } from "@openmantis/common/paths";
import { getTtsProvider, uploadToChannel } from "@openmantis/tts";
import type { ModelMessage } from "ai";
import { AgentFactory } from "../agent/factory";
import { createLanguageModel } from "../agent/providers";
import type {
	ChannelAdapter,
	GatewayResponse,
	IncomingMessage,
	OutgoingMessage,
} from "../channels/types";
import type { ChannelContext, ChannelToolProviders } from "../tools";
import { extractMemories } from "../tools/memory/extractor";

const logger = createLogger("core/gateway");

import type { ChannelBindings } from "./channel-bindings";
import { RouteStore } from "./route-store";
import { toStreamEvents } from "./stream-events";

async function buildAgentMessages(
	messages: ModelMessage[],
	incoming: IncomingMessage,
): Promise<ModelMessage[]> {
	const files = incoming.files;
	if (!files || files.length === 0) return messages;

	const imageFiles = files.filter((f) => f.mimeType?.startsWith("image/"));
	const otherFiles = files.filter((f) => !f.mimeType?.startsWith("image/"));

	// Build text content with file path annotations for non-image files
	let textContent = incoming.content;
	if (otherFiles.length > 0) {
		const annotations = otherFiles.map((f) => `[附件: ${f.fileName} → ${f.path}]`).join("\n");
		textContent = textContent ? `${textContent}\n${annotations}` : annotations;
	}

	const multiModalContent: (
		| { type: "text"; text: string }
		| { type: "image"; image: Buffer; mimeType?: string }
	)[] = [];
	if (textContent) {
		multiModalContent.push({ type: "text" as const, text: textContent });
	}

	// Read image files from disk for multi-modal LLM input
	for (const img of imageFiles) {
		try {
			const data = await Bun.file(img.path).arrayBuffer();
			multiModalContent.push({
				type: "image" as const,
				image: Buffer.from(data),
				...(img.mimeType ? { mimeType: img.mimeType } : {}),
			});
		} catch (err) {
			logger.warn(`[gateway] failed to read image file ${img.path}:`, err);
		}
	}

	if (multiModalContent.length > 0) {
		return [...messages.slice(0, -1), { role: "user" as const, content: multiModalContent }];
	}
	return messages;
}

function extractResponseText(messages: ModelMessage[]): string {
	return messages
		.filter((m) => m.role === "assistant")
		.map((m) => {
			if (typeof m.content === "string") return m.content;
			if (Array.isArray(m.content)) {
				return m.content
					.filter((p): p is { type: "text"; text: string } => p.type === "text")
					.map((p) => p.text)
					.join("");
			}
			return "";
		})
		.join("");
}

function buildFallbackResponse(result: {
	text: string;
	steps: { toolResults: any[] }[];
}): OutgoingMessage {
	return {
		content: result.text,
		toolCalls: result.steps.flatMap((s) =>
			s.toolResults.map((tr) => ({
				name: tr.toolName,
				args: tr.input as Record<string, unknown>,
				result: tr.output,
			})),
		),
	};
}

async function maybeRunAutoTts(params: {
	route: { voiceMode?: boolean };
	channel: ChannelContext;
	finalText: string;
	config: OpenMantisConfig;
}): Promise<void> {
	const { route, channel, finalText, config } = params;

	// 1. Resolve channel-side TTS config
	const channelTts = channel.channelType.startsWith("feishu")
		? config.feishu?.find((app) => `feishu:${app.name}` === channel.channelType)?.tts
		: channel.channelType === "wecom"
			? config.wecom?.tts
			: undefined;

	if (!channelTts) {
		logger.debug(`[gateway] auto-tts skip: channel ${channel.channelType} has no tts config`);
		return;
	}

	// 2. enabled gate (route override wins)
	const effectiveEnabled = route.voiceMode ?? channelTts.enabled;
	if (!effectiveEnabled) {
		logger.debug(`[gateway] auto-tts skip: voiceMode disabled for ${channel.channelType}`);
		return;
	}

	// 3. provider lookup
	const provider = getTtsProvider(channelTts.provider);
	if (!provider) {
		logger.warn(`[gateway] auto-tts skip: unknown provider ${channelTts.provider}`);
		return;
	}

	// 4. provider configured?
	if (!provider.isConfigured(config)) {
		logger.warn(`[gateway] auto-tts skip: provider ${provider.name} not configured`);
		return;
	}

	// 5. text checks
	const text = finalText.trim();
	if (!text) return;
	if (text.length > 2000) {
		logger.warn(`[gateway] auto-tts skipped: text length ${text.length} > 2000`);
		return;
	}

	// 6. synthesize + upload (style / direction resolved inside provider via config fallback)
	try {
		const useStream = config.xiaomiTts?.stream ?? true;
		logger.info(
			`[gateway] auto-tts triggered: channel=${channel.channelType}, provider=${provider.name}, textLen=${text.length}, stream=${useStream}, style=${config.xiaomiTts?.style || "(none)"}, direction=${config.xiaomiTts?.direction ? "(set)" : "(none)"}`,
		);
		const result = useStream
			? await provider.synthesizeStream({ text }, config)
			: await provider.synthesize({ text }, config);
		const up = await uploadToChannel(
			channel,
			{ filePath: result.filePath, durationMs: result.durationMs },
			config,
			channel.channelType === "wecom" ? getWecomClient() : undefined,
		);
		if (!up.ok) logger.warn(`[gateway] auto-tts upload failed: ${up.error}`);
		logger.info(
			`[gateway] auto-tts complete: durationMs=${result.durationMs}, uploaded=${up.ok}${up.mode ? `, mode=${up.mode}` : ""}`,
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.warn(`[gateway] auto-tts failed: ${message}`);
	}
}

interface GatewayOptions {
	routeDir?: string;
}

export class Gateway {
	private config: OpenMantisConfig;
	private channels: ChannelAdapter[];
	private channelBindings?: ChannelBindings;
	readonly routeStore: RouteStore;
	readonly factory: AgentFactory;
	private inflight = new Map<string, AbortController>();

	constructor(
		config: OpenMantisConfig,
		channels: ChannelAdapter[],
		options?: GatewayOptions & {
			channelBindings?: ChannelBindings;
			channelToolProviders?: ChannelToolProviders;
		},
	) {
		this.config = config;
		this.channels = channels;
		this.channelBindings = options?.channelBindings;
		const routeDir = options?.routeDir ?? ROUTES_DIR;
		this.routeStore = new RouteStore(routeDir, () => isBrowserCdpActive(this.config));
		this.factory = new AgentFactory(config, options?.channelToolProviders);
	}

	getConfig(): OpenMantisConfig {
		return this.config;
	}

	/**
	 * Abort the in-flight conversation for a given route, if any.
	 * Returns true if an inflight controller was found and aborted, false otherwise.
	 * Idempotent.
	 */
	abortRoute(routeId: string): boolean {
		const ctrl = this.inflight.get(routeId);
		if (!ctrl) return false;
		logger.info(`[gateway] aborting inflight conversation: route=${routeId}`);
		ctrl.abort();
		return true;
	}

	async pushMessage(channelType: string, channelId: string, content: string): Promise<void> {
		const channel = this.channels.find((ch) => ch.type === channelType);
		if (!channel) {
			throw new Error(`渠道 ${channelType} 未找到`);
		}
		if (!channel.pushMessage) {
			throw new Error(`渠道 ${channelType} 不支持 pushMessage`);
		}
		await channel.pushMessage(channelId, content);
	}

	async start(): Promise<void> {
		logger.info("Starting OpenMantis Gateway...");
		logger.debug(
			`Config: providers=${this.config.providers.map((p) => p.name).join(",")}, channels=${this.config.channels.join(",")}`,
		);

		for (const channel of this.channels) {
			await channel.init(this.handleMessage.bind(this));
			logger.info(`Channel started: ${channel.type}`);
		}

		logger.info("Gateway ready");

		await Promise.all(
			this.channels.map((ch) =>
				ch
					.run()
					.catch((err) =>
						logger.error(
							`Channel ${ch.type} error:`,
							err instanceof Error ? err.stack || err.message : err,
						),
					),
			),
		);
	}

	async stop(): Promise<void> {
		logger.info("Stopping OpenMantis Gateway...");
		for (const channel of this.channels) {
			await channel.stop();
		}
		logger.info("Gateway stopped");
	}

	async handleMessage(incoming: IncomingMessage): Promise<GatewayResponse> {
		const startTime = Date.now();

		const route = await this.routeStore.getOrCreate(
			incoming.routeId,
			incoming.channelType,
			incoming.channelId,
		);
		const isNewRoute = route.messages.length === 0;
		logger.debug(
			`[gateway] route ${isNewRoute ? "created" : "resumed"}: ${route.id}` +
				`, messages: ${route.messages.length}`,
		);

		// Reject concurrent agent messages on a busy route.
		// Slash commands bypass this path entirely (handled at channel layer).
		if (this.inflight.has(route.id)) {
			logger.warn(`[gateway] rejecting message: route ${route.id} is busy`);
			const rejected: OutgoingMessage = {
				content: "⏳ 当前对话正在进行中，发送 /stop 可终止",
				toolCalls: [],
			};
			return {
				stream: (async function* () {
					yield { type: "text-delta" as const, text: rejected.content };
				})(),
				response: Promise.resolve(rejected),
			};
		}

		// Persist text content with file annotations
		const fileCount = incoming.files?.length ?? 0;
		const persistedContent =
			fileCount > 0
				? `${incoming.content}${incoming.content ? "\n" : ""}[${fileCount} file(s) attached: ${incoming.files!.map((f) => f.fileName).join(", ")}]`
				: incoming.content;

		route.messages.push({ role: "user", content: persistedContent });

		await this.routeStore.save(route);

		// Resolve provider: route > channel binding > channel config > default
		const bindingsProvider = this.channelBindings?.getProvider(
			incoming.channelType,
			incoming.channelId,
		);
		const channelConfigProvider = (() => {
			const channelConf = this.config[incoming.channelType as keyof OpenMantisConfig];
			if (channelConf && typeof channelConf === "object" && !Array.isArray(channelConf)) {
				return (channelConf as { provider?: string }).provider;
			}
			if (Array.isArray(channelConf)) {
				// feishu is an array — provider comes from the matching entry, resolved elsewhere
				return undefined;
			}
			return undefined;
		})();
		const resolvedProvider =
			route.provider ?? bindingsProvider ?? channelConfigProvider ?? this.config.defaultProvider;
		logger.debug(`[gateway] provider=${resolvedProvider}`);

		// Build agent messages: use multi-modal content if files present
		const agentMessages = await buildAgentMessages(route.messages, incoming);

		const { agent } = await this.factory.create({
			provider: resolvedProvider,
			messages: agentMessages,
			channelType: incoming.channelType,
			channelId: incoming.channelId,
			routeId: route.id,
			metadata: incoming.metadata,
		});

		logger.debug(`[gateway] starting stream, messages: ${agentMessages.length}`);

		const controller = new AbortController();
		this.inflight.set(route.id, controller);
		logger.debug(`[gateway] inflight registered: route=${route.id}, total=${this.inflight.size}`);

		const abortedMarker = "\n\n[⏹ 已中断]";
		const isAbortError = (err: unknown): boolean =>
			err instanceof Error && (err.name === "AbortError" || err.name === "AbortSignal");

		const cleanupInflight = () => {
			if (this.inflight.get(route.id) === controller) {
				this.inflight.delete(route.id);
				logger.debug(
					`[gateway] inflight cleared: route=${route.id}, remaining=${this.inflight.size}`,
				);
			}
		};

		try {
			const streamResult = await agent.stream({
				messages: agentMessages,
				abortSignal: controller.signal,
			});

			const handleAborted = async (
				partialMessages: { role: string; content: unknown }[] | undefined,
			): Promise<OutgoingMessage> => {
				logger.info(
					`[gateway] stream aborted for route=${route!.id}, elapsed=${Date.now() - startTime}ms`,
				);
				logger.debug(`[gateway] abort partial messages: ${partialMessages?.length ?? 0}`);
				if (partialMessages && partialMessages.length > 0) {
					const last = partialMessages[partialMessages.length - 1];
					if (last && last.role === "assistant") {
						if (typeof last.content === "string") {
							last.content = last.content + abortedMarker;
						} else if (Array.isArray(last.content)) {
							let appended = false;
							for (let i = last.content.length - 1; i >= 0; i--) {
								const part = last.content[i] as { type: string; text?: string };
								if (part.type === "text" && typeof part.text === "string") {
									part.text = part.text + abortedMarker;
									appended = true;
									break;
								}
							}
							if (!appended) {
								(last.content as unknown[]).push({
									type: "text",
									text: abortedMarker.trimStart(),
								});
							}
						}
					}
					route!.messages.push(...(partialMessages as ModelMessage[]));
				} else {
					route!.messages.push({ role: "assistant", content: abortedMarker.trimStart() });
				}
				await this.routeStore
					.save(route!)
					.catch((e) => logger.warn("[gateway] save after abort failed:", e));
				return { content: "⏹ 对话已被终止", toolCalls: [] };
			};

			const response = Promise.resolve(streamResult.response)
				.then(async (res) => {
					// AI SDK may resolve `response` normally even when aborted (the stream
					// just ends gracefully). Detect that case via the abort signal.
					if (controller.signal.aborted) {
						return handleAborted(res.messages as { role: string; content: unknown }[]);
					}

					logger.debug(
						`[gateway] stream completed in ${Date.now() - startTime}ms, response messages: ${res.messages.length}`,
					);

					route!.messages.push(...res.messages);

					// Log reasoning content at debug level
					const reasoning = await streamResult.reasoning;
					if (reasoning.length > 0) {
						const reasoningText = reasoning
							.map((r) => (r.type === "reasoning" ? r.text : ""))
							.join("");
						if (reasoningText) {
							logger.debug(`[gateway] thinking: ${reasoningText.slice(0, 500)}`);
						}
					}

					await this.routeStore.save(route!);

					const text = extractResponseText(res.messages);

					let content = text || (await streamResult.text) || "";
					if (!content) {
						logger.warn("[gateway] empty response: model produced no text output");
						content = "⚠️ 操作已执行但回复被截断（工具调用次数达到上限）。请发送消息继续对话。";
					}

					await maybeRunAutoTts({
						route: route!,
						channel: {
							channelType: incoming.channelType,
							channelId: incoming.channelId,
							routeId: route!.id,
						},
						finalText: content,
						config: this.config,
					});

					// Async memory extraction (fire-and-forget, non-blocking)
					if (this.config.memory?.enabled !== false && this.config.memory?.autoExtract !== false) {
						const memMinMessages = this.config.memory?.autoExtractMinMessages ?? 3;
						(async () => {
							try {
								const provName = route!.provider ?? this.config.defaultProvider;
								const provConfig = resolveProvider(this.config, provName);
								const modelConfig = provConfig.models[0]!;
								const memModel = await createLanguageModel(provConfig, modelConfig);
								await extractMemories({
									messages: route!.messages,
									model: memModel,
									channelId: incoming.channelId,
									routeId: route!.id,
									minMessages: memMinMessages,
								});
							} catch (err) {
								logger.warn("[gateway] memory extraction failed:", err);
							}
						})();
					}

					return {
						content,
						toolCalls: [],
					} as OutgoingMessage;
				})
				.catch(async (err) => {
					if (!isAbortError(err)) throw err;
					const partial = await Promise.resolve(streamResult.response).catch(() => undefined);
					return handleAborted(
						partial?.messages as { role: string; content: unknown }[] | undefined,
					);
				})
				.finally(() => {
					cleanupInflight();
				});

			const routeIdForLog = route.id;
			const signal = controller.signal;
			async function* wrappedStream(): AsyncGenerator<import("./stream-events").StreamEvent> {
				try {
					for await (const ev of toStreamEvents(streamResult.fullStream)) {
						yield ev;
						if (signal.aborted) break;
					}
				} catch (err) {
					if (isAbortError(err)) {
						logger.info(`[gateway] emitting aborted stream event: route=${routeIdForLog}`);
						yield { type: "aborted" };
						return;
					}
					throw err;
				}
				if (signal.aborted) {
					logger.info(`[gateway] emitting aborted stream event: route=${routeIdForLog}`);
					yield { type: "aborted" };
				}
			}

			return {
				stream: wrappedStream(),
				response,
			};
		} catch (streamErr) {
			// Fallback to non-streaming generate
			logger.warn("Streaming failed, falling back to generate:", streamErr);

			try {
				logger.debug("[gateway] fallback: starting generate");
				const result = await agent.generate({
					messages: agentMessages,
					abortSignal: controller.signal,
				});

				const toolCallCount = result.steps.reduce((sum, s) => sum + s.toolResults.length, 0);
				logger.debug(
					`[gateway] fallback completed: steps=${result.steps.length}, toolCalls=${toolCallCount}, responseLen=${result.text.length}`,
				);
				route.messages.push(...result.response.messages);

				await this.routeStore.save(route);
				logger.debug(`[gateway] fallback completed in ${Date.now() - startTime}ms`);

				const fallbackText =
					result.text || "⚠️ 操作已执行但回复被截断（工具调用次数达到上限）。请发送消息继续对话。";
				if (!result.text) {
					logger.warn("[gateway] empty response: model produced no text output (fallback)");
				}

				const outgoing = buildFallbackResponse({ ...result, text: fallbackText });

				await maybeRunAutoTts({
					route,
					channel: {
						channelType: incoming.channelType,
						channelId: incoming.channelId,
						routeId: route.id,
					},
					finalText: result.text,
					config: this.config,
				});

				cleanupInflight();
				return {
					stream: (async function* () {})(),
					response: Promise.resolve(outgoing),
				};
			} catch (fallbackErr) {
				const error = fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr));

				if (isAbortError(error)) {
					logger.info(`[gateway] fallback generate aborted for route=${route.id}`);
					route.messages.push({ role: "assistant", content: "[⏹ 已中断]" });
					await this.routeStore.save(route).catch((saveErr) => {
						logger.warn("Failed to save route:", saveErr);
					});
					cleanupInflight();
					const outgoing: OutgoingMessage = { content: "⏹ 对话已被终止", toolCalls: [] };
					async function* abortedOnly(): AsyncGenerator<import("./stream-events").StreamEvent> {
						yield { type: "aborted" };
					}
					return {
						stream: abortedOnly(),
						response: Promise.resolve(outgoing),
					};
				}

				await this.routeStore.save(route).catch((saveErr) => {
					logger.warn("Failed to save route:", saveErr);
				});

				logger.error(`[gateway] error after ${Date.now() - startTime}ms: ${error.message}`);

				cleanupInflight();
				const rejected = Promise.reject(error);
				rejected.catch(() => {}); // prevent unhandled rejection if consumer ignores response
				return {
					stream: (async function* () {})(),
					response: rejected,
				};
			}
		}
	}
}
