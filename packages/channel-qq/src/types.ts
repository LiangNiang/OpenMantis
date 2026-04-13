export interface QQConfig {
	appId: string;
	clientSecret: string;
	sandbox?: boolean;
}

export interface ParsedQQAttachment {
	url: string;
	contentType: string;
	filename: string;
}

export interface ParsedQQContent {
	text: string;
	attachments: ParsedQQAttachment[];
	msgId: string;
	userOpenId: string;
	groupOpenId?: string;
	memberOpenId?: string;
}

/** QQ Bot API v2 gateway payload */
export interface QQGatewayPayload {
	op: number;
	s?: number;
	t?: string;
	d?: any;
	id?: string;
}

/** GET /gateway/bot response */
export interface QQGatewayInfo {
	url: string;
	shards: number;
	session_start_limit: {
		total: number;
		remaining: number;
		reset_after: number;
		max_concurrency: number;
	};
}

/** POST /v2/users/{openid}/messages or /v2/groups/{group_openid}/messages */
export interface QQSendMessageParams {
	msg_type: 0 | 2 | 3 | 4 | 7;
	content?: string;
	markdown?: { content: string };
	media?: { file_info: string };
	msg_id?: string;
	msg_seq?: number;
}

export interface QQMessageResult {
	id: string;
	timestamp: string;
}

export interface QQMediaResult {
	file_uuid: string;
	file_info: string;
	ttl: number;
}

// ============ 分片上传 API ============

/** 分片信息 */
export interface UploadPart {
	/** 分片索引（从 1 开始） */
	index: number;
	/** 预签名上传链接（COS） */
	presigned_url: string;
}

/** upload_prepare 响应 */
export interface UploadPrepareResponse {
	upload_id: string;
	block_size: number;
	parts: UploadPart[];
	concurrency?: number;
	/** partFinish 特定错误码的重试超时（秒） */
	retry_timeout?: number;
}

/** 文件哈希信息 */
export interface FileHashes {
	md5: string;
	sha1: string;
	md5_10m: string;
}

// ============ 流式消息 API ============

/** 流式消息输入模式 */
export const StreamInputMode = {
	/** 每次发送的 content_raw 替换整条消息内容 */
	REPLACE: "replace",
} as const;
export type StreamInputMode = (typeof StreamInputMode)[keyof typeof StreamInputMode];

/** 流式消息输入状态 */
export const StreamInputState = {
	/** 正文生成中 */
	GENERATING: 1,
	/** 正文生成结束（终结状态） */
	DONE: 10,
} as const;
export type StreamInputState = (typeof StreamInputState)[keyof typeof StreamInputState];

/** 流式消息内容类型 */
export const StreamContentType = {
	MARKDOWN: "markdown",
} as const;
export type StreamContentType = (typeof StreamContentType)[keyof typeof StreamContentType];

/** 流式消息请求体 */
export interface StreamMessageRequest {
	input_mode: StreamInputMode;
	input_state: StreamInputState;
	content_type: StreamContentType;
	content_raw: string;
	event_id: string;
	msg_id: string;
	stream_msg_id?: string;
	msg_seq: number;
	index: number;
}

/** 流式消息响应 */
export interface StreamMessageResult {
	id: string;
	timestamp?: string;
}
