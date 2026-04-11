import { createLogger } from "@openmantis/common/logger";

const logger = createLogger("channel-qq");
import type { QQApi } from "./api";
import type { QQGatewayPayload } from "./types";

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000];

const INTENTS = 1 << 25;

type EventHandler = (eventType: string, data: any) => void;

export class QQGateway {
	private api: QQApi;
	private ws: WebSocket | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private heartbeatInterval = 45000;
	private seq: number | null = null;
	private sessionId: string | null = null;
	private missedAcks = 0;
	private reconnectAttempt = 0;
	private stopping = false;
	private gatewayUrl = "";
	private eventHandler: EventHandler | null = null;

	constructor(api: QQApi) {
		this.api = api;
	}

	onEvent(handler: EventHandler): void {
		this.eventHandler = handler;
	}

	async start(): Promise<void> {
		this.stopping = false;
		logger.info("[qq] fetching gateway URL...");
		const info = await this.api.getGatewayUrl();
		this.gatewayUrl = info.url;
		logger.info(
			`[qq] gateway URL: ${this.gatewayUrl}, shards: ${info.shards}, remaining sessions: ${info.session_start_limit?.remaining}`,
		);
		this.connect();
	}

	async stop(): Promise<void> {
		this.stopping = true;
		this.clearHeartbeat();
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		logger.info("[qq] gateway stopped");
	}

	private connect(): void {
		if (this.stopping) return;

		const ws = new WebSocket(this.gatewayUrl);
		this.ws = ws;

		ws.onopen = () => {
			logger.debug("[qq] WebSocket connected");
		};

		ws.onmessage = (event) => {
			const payload: QQGatewayPayload = JSON.parse(
				typeof event.data === "string" ? event.data : "",
			);
			this.handlePayload(payload);
		};

		ws.onclose = (event) => {
			logger.warn(
				`[qq] WebSocket closed: code=${event.code} reason=${event.reason || "(no reason)"}`,
			);
			this.clearHeartbeat();
			if (!this.stopping) {
				this.scheduleReconnect();
			}
		};

		ws.onerror = (event) => {
			const msg = event instanceof ErrorEvent ? event.message : String(event?.type ?? event);
			logger.error("[qq] WebSocket error:", msg);
		};
	}

	private handlePayload(payload: QQGatewayPayload): void {
		if (payload.s != null) {
			this.seq = payload.s;
		}

		switch (payload.op) {
			case OP_HELLO:
				this.heartbeatInterval = payload.d?.heartbeat_interval ?? 45000;
				if (this.sessionId && this.seq != null) {
					this.sendResume();
				} else {
					this.sendIdentify();
				}
				break;

			case OP_DISPATCH:
				this.reconnectAttempt = 0;
				if (payload.t === "READY") {
					this.sessionId = payload.d?.session_id;
					logger.info("[qq] authenticated, session:", this.sessionId);
					this.startHeartbeat();
				} else if (payload.t === "RESUMED") {
					logger.info("[qq] session resumed");
					this.startHeartbeat();
				} else if (payload.t && this.eventHandler) {
					this.eventHandler(payload.t, payload.d);
				}
				break;

			case OP_HEARTBEAT_ACK:
				this.missedAcks = 0;
				break;

			case OP_RECONNECT:
				logger.warn("[qq] server requested reconnect");
				this.ws?.close();
				break;

			case OP_INVALID_SESSION:
				logger.warn("[qq] invalid session, re-identifying");
				this.sessionId = null;
				this.seq = null;
				setTimeout(
					() => {
						if (!this.stopping) this.connect();
					},
					1000 + Math.random() * 4000,
				);
				break;
		}
	}

	private async sendIdentify(): Promise<void> {
		const token = await this.api.getAccessToken();
		logger.debug(`[qq] sending Identify, intents=${INTENTS}, shard=[0,1]`);
		this.send({
			op: OP_IDENTIFY,
			d: {
				token: `QQBot ${token}`,
				intents: INTENTS,
				shard: [0, 1],
				properties: {
					$os: process.platform,
					$browser: "openmantis",
					$device: "openmantis",
				},
			},
		});
	}

	private async sendResume(): Promise<void> {
		const token = await this.api.getAccessToken();
		this.send({
			op: OP_RESUME,
			d: {
				token: `QQBot ${token}`,
				session_id: this.sessionId,
				seq: this.seq,
			},
		});
	}

	private startHeartbeat(): void {
		this.clearHeartbeat();
		this.missedAcks = 0;
		this.heartbeatTimer = setInterval(() => {
			if (this.missedAcks >= 2) {
				logger.warn("[qq] missed 2 heartbeat ACKs, reconnecting");
				this.ws?.close();
				return;
			}
			this.missedAcks++;
			this.send({ op: OP_HEARTBEAT, d: this.seq });
		}, this.heartbeatInterval);
	}

	private clearHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	private scheduleReconnect(): void {
		if (this.stopping) return;
		const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
		this.reconnectAttempt++;
		logger.info(`[qq] reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
		setTimeout(() => {
			if (!this.stopping) this.connect();
		}, delay);
	}

	private send(payload: QQGatewayPayload): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(payload));
		}
	}
}
