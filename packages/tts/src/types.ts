/**
 * Minimal config slice consumed by the tts package.
 * Matches the relevant fields of OpenMantisConfig structurally,
 * so the full OpenMantisConfig can be passed without casting.
 */
export interface TtsConfig {
	xiaomiTts?: {
		apiKey?: string;
		baseUrl?: string;
		voice?: string;
		style?: string;
		direction?: string;
	};
	feishu?: Array<{
		name: string;
		appId?: string;
		appSecret?: string;
	}>;
	providers?: Array<{
		provider: string;
		apiKey?: string;
		baseUrl?: string;
	}>;
}

/**
 * Minimal channel context used to route audio uploads.
 * Matches the ChannelContext interface in core structurally.
 */
export interface TtsChannelContext {
	channelType: string;
	channelId: string;
}

/**
 * Minimal WecomClient interface required by the upload module.
 * Structurally matches the WSClient from @wecom/aibot-node-sdk.
 */
export interface WecomClientLike {
	uploadMedia(
		buffer: Buffer,
		options: { type: "voice" | "file"; filename: string },
	): Promise<{ media_id: string }>;
	sendMediaMessage(chatId: string, type: "voice" | "file", mediaId: string): Promise<unknown>;
}
