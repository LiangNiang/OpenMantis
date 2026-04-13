/**
 * C2C "正在输入" 状态自动续期
 *
 * QQ API 的 input_notify 状态有时效性（input_second 秒后过期），
 * 在 agent 处理消息期间需要定时续发，让用户持续看到"正在输入"。
 * 仅 C2C 私聊有效，群聊不支持。
 */

import { createLogger } from "@openmantis/common/logger";
import type { QQApi } from "./api";

const logger = createLogger("channel-qq");

/** 每次通知持续 60 秒 */
const INPUT_SECOND = 60;
/** 每 50 秒续发一次（留 10s 余量） */
const INTERVAL_MS = 50_000;

export class TypingKeepAlive {
	private timer: ReturnType<typeof setInterval> | null = null;
	private stopped = false;

	constructor(
		private readonly api: QQApi,
		private readonly openid: string,
		private readonly msgId: string,
		private readonly getMsgSeq: () => number,
	) {}

	/** 发送首次通知并启动定时续期 */
	async start(): Promise<void> {
		if (this.stopped) return;
		try {
			await this.api.sendC2CInputNotify(
				this.openid,
				this.msgId,
				this.getMsgSeq(),
				INPUT_SECOND,
			);
			logger.debug(`[qq:typing] started for ${this.openid}`);
		} catch (err) {
			logger.debug(`[qq:typing] initial notify failed: ${err}`);
			return;
		}
		if (this.stopped) return;
		this.timer = setInterval(() => {
			if (this.stopped) {
				this.stop();
				return;
			}
			this.api
				.sendC2CInputNotify(this.openid, this.msgId, this.getMsgSeq(), INPUT_SECOND)
				.catch((err) => {
					logger.debug(`[qq:typing] keep-alive failed: ${err}`);
				});
		}, INTERVAL_MS);
	}

	/** 停止续期 */
	stop(): void {
		this.stopped = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}
}
