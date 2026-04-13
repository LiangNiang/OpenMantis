import { createLogger } from "@openmantis/common/logger";

const logger = createLogger("channel-qq");
import type {
	FileHashes,
	QQConfig,
	QQGatewayInfo,
	QQMediaResult,
	QQMessageResult,
	QQSendMessageParams,
	StreamMessageRequest,
	StreamMessageResult,
	UploadPrepareResponse,
} from "./types";

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const API_BASE_PROD = "https://api.sgroup.qq.com";
const API_BASE_SANDBOX = "https://sandbox.api.sgroup.qq.com";

export class QQApi {
	private config: QQConfig;
	private apiBase: string;
	private accessToken = "";
	private tokenExpiresAt = 0;
	private tokenRefreshPromise: Promise<string> | null = null;

	constructor(config: QQConfig) {
		this.config = config;
		this.apiBase = config.sandbox ? API_BASE_SANDBOX : API_BASE_PROD;
	}

	async getAccessToken(): Promise<string> {
		const now = Date.now();
		if (this.accessToken && now < this.tokenExpiresAt) {
			return this.accessToken;
		}
		if (this.tokenRefreshPromise) {
			return this.tokenRefreshPromise;
		}
		this.tokenRefreshPromise = this.refreshToken();
		try {
			return await this.tokenRefreshPromise;
		} finally {
			this.tokenRefreshPromise = null;
		}
	}

	private async refreshToken(): Promise<string> {
		const res = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				appId: this.config.appId,
				clientSecret: this.config.clientSecret,
			}),
		});
		if (!res.ok) {
			throw new Error(`Failed to get access token: ${res.status} ${res.statusText}`);
		}
		const data = await res.json();
		if (data.code) {
			throw new Error(
				`[qq] failed to get access token: code=${data.code}, message=${data.message}`,
			);
		}
		this.accessToken = data.access_token;
		if (!this.accessToken) {
			throw new Error(`[qq] token response missing access_token: ${JSON.stringify(data)}`);
		}
		const expiresIn = Number.parseInt(String(data.expires_in ?? "0"), 10);
		// Refresh at 1/3 of the expiry window to avoid using a nearly-expired token
		this.tokenExpiresAt = Date.now() + (expiresIn * 1000) / 3;
		logger.info(`[qq] access token acquired, expires in ${expiresIn}s`);
		return this.accessToken;
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const token = await this.getAccessToken();
		logger.debug(`[qq] API ${method} ${this.apiBase}${path}`);
		const res = await fetch(`${this.apiBase}${path}`, {
			method,
			headers: {
				Authorization: `QQBot ${token}`,
				"Content-Type": "application/json",
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			if (res.status === 401) {
				this.tokenExpiresAt = 0;
				const newToken = await this.getAccessToken();
				const retryRes = await fetch(`${this.apiBase}${path}`, {
					method,
					headers: {
						Authorization: `QQBot ${newToken}`,
						"Content-Type": "application/json",
					},
					body: body ? JSON.stringify(body) : undefined,
				});
				if (!retryRes.ok) {
					const retryText = await retryRes.text().catch(() => "");
					throw new Error(
						`QQ API ${method} ${path} failed after token refresh: ${retryRes.status} ${retryText}`,
					);
				}
				return retryRes.json() as T;
			}
			throw new Error(`QQ API ${method} ${path} failed: ${res.status} ${text}`);
		}
		const json = await res.json();
		// QQ API may return 200 with error in body
		if (json?.code) {
			throw new Error(
				`QQ API ${method} ${path} error: code=${json.code}, message=${json.message ?? ""}`,
			);
		}
		return json as T;
	}

	async getGatewayUrl(): Promise<QQGatewayInfo> {
		return this.request<QQGatewayInfo>("GET", "/gateway/bot");
	}

	async sendC2CMessage(openid: string, params: QQSendMessageParams): Promise<QQMessageResult> {
		return this.request<QQMessageResult>("POST", `/v2/users/${openid}/messages`, params);
	}

	async sendGroupMessage(
		groupOpenid: string,
		params: QQSendMessageParams,
	): Promise<QQMessageResult> {
		return this.request<QQMessageResult>("POST", `/v2/groups/${groupOpenid}/messages`, params);
	}

	/**
	 * 发送 C2C "正在输入" 状态通知（仅私聊有效）。
	 * msg_type=6, input_notify.input_type=1 表示文字输入中。
	 */
	async sendC2CInputNotify(
		openid: string,
		msgId: string,
		msgSeq: number,
		inputSecond = 60,
	): Promise<void> {
		await this.request<unknown>("POST", `/v2/users/${openid}/messages`, {
			msg_type: 6,
			input_notify: {
				input_type: 1,
				input_second: inputSecond,
			},
			msg_id: msgId,
			msg_seq: msgSeq,
		});
	}

	async sendC2CStreamMessage(
		openid: string,
		req: StreamMessageRequest,
	): Promise<StreamMessageResult> {
		return this.request<StreamMessageResult>("POST", `/v2/users/${openid}/stream_messages`, {
			input_mode: req.input_mode,
			input_state: req.input_state,
			content_type: req.content_type,
			content_raw: req.content_raw,
			event_id: req.event_id,
			msg_id: req.msg_id,
			msg_seq: req.msg_seq,
			index: req.index,
			...(req.stream_msg_id ? { stream_msg_id: req.stream_msg_id } : {}),
		});
	}

	async uploadC2CMedia(
		openid: string,
		fileType: number,
		options: { url?: string; fileData?: string },
		srvSendMsg = true,
	): Promise<QQMediaResult> {
		return this.request<QQMediaResult>("POST", `/v2/users/${openid}/files`, {
			file_type: fileType,
			url: options.url ?? "",
			file_data: options.fileData,
			srv_send_msg: srvSendMsg,
		});
	}

	async uploadGroupMedia(
		groupOpenid: string,
		fileType: number,
		options: { url?: string; fileData?: string },
		srvSendMsg = true,
	): Promise<QQMediaResult> {
		return this.request<QQMediaResult>("POST", `/v2/groups/${groupOpenid}/files`, {
			file_type: fileType,
			url: options.url ?? "",
			file_data: options.fileData,
			srv_send_msg: srvSendMsg,
		});
	}

	// ---- 分片上传 API ----

	async c2cUploadPrepare(
		openid: string,
		fileType: number,
		fileName: string,
		fileSize: number,
		hashes: FileHashes,
	): Promise<UploadPrepareResponse> {
		return this.request<UploadPrepareResponse>("POST", `/v2/users/${openid}/upload_prepare`, {
			file_type: fileType,
			file_name: fileName,
			file_size: fileSize,
			...hashes,
		});
	}

	async c2cUploadPartFinish(
		openid: string,
		uploadId: string,
		partIndex: number,
		blockSize: number,
		md5: string,
	): Promise<void> {
		await this.request<unknown>("POST", `/v2/users/${openid}/upload_part_finish`, {
			upload_id: uploadId,
			part_index: partIndex,
			block_size: blockSize,
			md5,
		});
	}

	async c2cCompleteUpload(openid: string, uploadId: string): Promise<QQMediaResult> {
		return this.request<QQMediaResult>("POST", `/v2/users/${openid}/files`, {
			upload_id: uploadId,
		});
	}

	async groupUploadPrepare(
		groupOpenid: string,
		fileType: number,
		fileName: string,
		fileSize: number,
		hashes: FileHashes,
	): Promise<UploadPrepareResponse> {
		return this.request<UploadPrepareResponse>(
			"POST",
			`/v2/groups/${groupOpenid}/upload_prepare`,
			{
				file_type: fileType,
				file_name: fileName,
				file_size: fileSize,
				...hashes,
			},
		);
	}

	async groupUploadPartFinish(
		groupOpenid: string,
		uploadId: string,
		partIndex: number,
		blockSize: number,
		md5: string,
	): Promise<void> {
		await this.request<unknown>("POST", `/v2/groups/${groupOpenid}/upload_part_finish`, {
			upload_id: uploadId,
			part_index: partIndex,
			block_size: blockSize,
			md5,
		});
	}

	async groupCompleteUpload(groupOpenid: string, uploadId: string): Promise<QQMediaResult> {
		return this.request<QQMediaResult>("POST", `/v2/groups/${groupOpenid}/files`, {
			upload_id: uploadId,
		});
	}
}
