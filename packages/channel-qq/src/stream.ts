/**
 * QQ Bot C2C 流式消息控制器
 *
 * 使用 QQ 原生流式 API (/v2/users/{openid}/stream_messages)：
 * - input_mode: "replace" — 每次发送替换整条消息内容（用户看到一条消息在不断更新）
 * - input_state: 1 (GENERATING) / 10 (DONE) — 控制流式生命周期
 * - stream_msg_id — 首次调用返回，后续分片复用同一 ID
 *
 * 状态机：idle → streaming → completed / aborted
 * 降级：流式 API 不可用时自动回退到普通消息发送
 */

import { createLogger } from "@openmantis/common/logger";

export type StreamEvent =
	| { type: "text-delta"; text: string }
	| { type: "tool-start"; toolName: string; args: string }
	| { type: "tool-end"; toolName: string }
	| { type: "step-start" }
	| { type: "step-end" }
	| { type: "error"; message: string }
	| { type: "aborted" };

const logger = createLogger("channel-qq");
import type { QQApi } from "./api";
import { StreamContentType, StreamInputMode, StreamInputState } from "./types";

// ============ 常量 ============

/** 节流常量（毫秒） */
const THROTTLE = {
	/** 默认节流间隔 */
	DEFAULT_MS: 500,
	/** 最小节流间隔 */
	MIN_MS: 300,
	/** 长间隔阈值：超过此时间后的首次 flush 延迟处理 */
	LONG_GAP_MS: 2000,
	/** 长间隔后的批处理窗口 */
	BATCH_AFTER_GAP_MS: 300,
} as const;

/** 安全超时（5 分钟） */
const TIMEOUT_MS = 5 * 60 * 1000;

/** 流式状态机阶段 */
type Phase = "idle" | "streaming" | "completed" | "aborted";

/** 终态集合 */
const TERMINAL: Set<Phase> = new Set(["completed", "aborted"]);

/** 允许的状态转换 */
const TRANSITIONS: Record<Phase, Set<Phase>> = {
	idle: new Set(["streaming", "aborted"]),
	streaming: new Set(["idle", "completed", "aborted"]),
	completed: new Set(),
	aborted: new Set(),
};

// ============ FlushController ============

/**
 * 节流刷新控制器（纯调度原语，不含业务逻辑）
 */
class FlushController {
	private doFlush: () => Promise<void>;
	private inProgress = false;
	private resolvers: Array<() => void> = [];
	private needsReflush = false;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private lastTime = 0;
	private done = false;
	private _ready = false;

	constructor(doFlush: () => Promise<void>) {
		this.doFlush = doFlush;
	}

	get ready(): boolean {
		return this._ready;
	}

	setReady(ready: boolean): void {
		this._ready = ready;
		if (ready) this.lastTime = Date.now();
	}

	complete(): void {
		this.done = true;
	}

	cancelTimer(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	waitForFlush(): Promise<void> {
		if (!this.inProgress) return Promise.resolve();
		return new Promise<void>((r) => this.resolvers.push(r));
	}

	async cancelAndWait(): Promise<void> {
		this.cancelTimer();
		this.needsReflush = false;
		await this.waitForFlush();
		this.cancelTimer();
		this.needsReflush = false;
	}

	async flush(): Promise<void> {
		if (!this._ready || this.inProgress || this.done) {
			if (this.inProgress && !this.done) this.needsReflush = true;
			return;
		}

		this.inProgress = true;
		this.needsReflush = false;
		this.lastTime = Date.now();

		try {
			await this.doFlush();
			this.lastTime = Date.now();
		} finally {
			this.inProgress = false;
			const fns = this.resolvers;
			this.resolvers = [];
			for (const fn of fns) fn();

			if (this.needsReflush && !this.done && !this.timer) {
				this.needsReflush = false;
				this.timer = setTimeout(() => {
					this.timer = null;
					void this.flush();
				}, 0);
			}
		}
	}

	async throttled(ms: number): Promise<void> {
		if (!this._ready) return;

		const elapsed = Date.now() - this.lastTime;

		if (elapsed >= ms) {
			this.cancelTimer();
			if (elapsed > THROTTLE.LONG_GAP_MS) {
				// 长间隔后首次 flush 延迟，等待更多文本积累
				this.lastTime = Date.now();
				this.timer = setTimeout(() => {
					this.timer = null;
					void this.flush();
				}, THROTTLE.BATCH_AFTER_GAP_MS);
			} else {
				await this.flush();
			}
		} else if (!this.timer) {
			const delay = ms - elapsed;
			this.timer = setTimeout(() => {
				this.timer = null;
				void this.flush();
			}, delay);
		}
	}
}

// ============ streamQQReply ============

/**
 * 使用 QQ 原生流式 API 发送 C2C 消息。
 * 群聊不支持流式，仅 C2C 可用。
 *
 * @returns 最终文本内容（用于 OutgoingMessage）
 */
export async function streamQQReply(
	api: QQApi,
	openid: string,
	msgId: string,
	eventStream: AsyncIterable<StreamEvent>,
): Promise<string> {
	// ---- 状态 ----
	let phase: Phase = "idle";
	let textContent = "";
	let streamMsgId: string | null = null;
	let chunkIndex = 0;
	/** 同一流式会话内所有 chunk 共享同一个 msg_seq（参考 QQ 流式 API 协议） */
	let streamMsgSeq: number | null = null;
	let msgSeqCounter = 1;
	let sentChunkCount = 0;
	const startTime = Date.now();

	const flushCtrl = new FlushController(() => performFlush());
	const throttleMs = Math.max(THROTTLE.DEFAULT_MS, THROTTLE.MIN_MS);

	// ---- 状态机 ----

	function transition(to: Phase, source: string): boolean {
		const from = phase;
		if (from === to) return false;
		if (!TRANSITIONS[from].has(to)) {
			logger.warn(`[qq:stream] phase transition rejected: ${from} → ${to} (${source})`);
			return false;
		}
		phase = to;
		logger.debug(`[qq:stream] phase: ${from} → ${to} (${source})`);
		if (TERMINAL.has(to)) {
			flushCtrl.cancelTimer();
			flushCtrl.complete();
		}
		return true;
	}

	// ---- 构建展示内容 ----
	// QQ 流式 API replace 模式要求内容只能追加，不能修改已发送的前缀。
	// 因此不能在文本后附加会变化的工具状态块（文本增长会改变分隔符前的内容）。

	function buildDisplay(): string {
		return textContent || "...";
	}

	// ---- 发送流式分片 ----

	async function sendChunk(
		content: string,
		inputState: (typeof StreamInputState)[keyof typeof StreamInputState],
		caller: string,
	): Promise<{ id: string }> {
		// 同一流式会话内所有 chunk 共享同一个 msg_seq；新会话首次发送时生成
		if (streamMsgSeq === null) {
			streamMsgSeq = msgSeqCounter++;
		}

		logger.debug(
			`[qq:stream] sendChunk: caller=${caller}, state=${inputState}, len=${content.length}, streamMsgId=${streamMsgId}, index=${chunkIndex}`,
		);

		const resp = await api.sendC2CStreamMessage(openid, {
			input_mode: StreamInputMode.REPLACE,
			input_state: inputState,
			content_type: StreamContentType.MARKDOWN,
			content_raw: content,
			event_id: msgId,
			msg_id: msgId,
			stream_msg_id: streamMsgId ?? undefined,
			msg_seq: streamMsgSeq,
			index: chunkIndex++,
		});

		sentChunkCount++;
		return resp;
	}

	// ---- 启动流式会话 ----

	async function ensureStarted(): Promise<void> {
		if (streamMsgId || TERMINAL.has(phase)) return;
		if (!transition("streaming", "ensureStarted")) return;

		try {
			const content = buildDisplay();
			const resp = await sendChunk(content, StreamInputState.GENERATING, "start");
			if (!resp.id) {
				throw new Error(`Stream API returned no id: ${JSON.stringify(resp)}`);
			}
			streamMsgId = resp.id;
			flushCtrl.setReady(true);
			logger.info(`[qq:stream] started, stream_msg_id=${resp.id}`);
		} catch (err) {
			logger.error(`[qq:stream] failed to start: ${err}`);
			// 回退到 idle，后续可降级
			transition("idle", "start_failed");
		}
	}

	// ---- flush 实现 ----

	async function performFlush(): Promise<void> {
		if (!streamMsgId || TERMINAL.has(phase)) return;

		const content = buildDisplay();
		if (!content) return;

		try {
			await sendChunk(content, StreamInputState.GENERATING, "flush");
		} catch (err) {
			logger.warn(`[qq:stream] flush failed, will retry: ${err}`);
		}
	}

	// ---- 消费事件流 ----

	try {
		for await (const event of eventStream) {
			if (TERMINAL.has(phase)) break;
			if (Date.now() - startTime > TIMEOUT_MS) {
				logger.warn("[qq:stream] 5-min safety timeout, finishing early");
				break;
			}

			switch (event.type) {
				case "text-delta":
					textContent += event.text;
					break;
				case "aborted":
					logger.info("[qq] received aborted event, appending stopped marker");
					textContent += "\n\n⏹ 已停止";
					break;
				case "tool-start":
				case "tool-end":
					// 工具状态不纳入流式内容（QQ replace 模式要求只能追加，不能修改前缀）
					break;
				default:
					continue;
			}

			// 有内容后启动流式会话
			if (!streamMsgId && textContent.trim()) {
				await ensureStarted();
				if (TERMINAL.has(phase)) break;
			}

			// 节流更新
			if (streamMsgId) {
				await flushCtrl.throttled(throttleMs);
			}
		}
	} catch (err) {
		logger.error(`[qq:stream] event consumption error: ${err}`);
	}

	// ---- 终结 ----

	// 等待 pending flush 完成
	await flushCtrl.cancelAndWait();

	if (!TERMINAL.has(phase)) {
		if (streamMsgId) {
			// 有活跃流式会话 → 发终结分片
			transition("completed", "finish");
			try {
				const finalContent = textContent || "(empty response)";
				await sendChunk(finalContent, StreamInputState.DONE, "finish");
				logger.info(`[qq:stream] completed, chunks=${sentChunkCount}, len=${textContent.length}`);
			} catch (err) {
				logger.error(`[qq:stream] failed to send final chunk: ${err}`);
			}
		} else if (sentChunkCount === 0) {
			// 从未发出任何分片 → 降级标记
			transition("aborted", "nothing_sent");
			logger.info("[qq:stream] no chunk sent, falling back to static");
		} else {
			transition("completed", "no_active_session");
		}
	}

	// ---- 降级：流式 API 不可用时回退到普通消息 ----

	if ((phase as Phase) === "aborted" && sentChunkCount === 0) {
		logger.info("[qq:stream] fallback: sending as regular message");
		try {
			await api.sendC2CMessage(openid, {
				msg_type: 2,
				markdown: { content: textContent || "(empty response)" },
				msg_id: msgId,
				msg_seq: msgSeqCounter++,
			});
		} catch (fallbackErr) {
			logger.error(`[qq:stream] fallback send failed: ${fallbackErr}`);
		}
	}

	return textContent;
}
