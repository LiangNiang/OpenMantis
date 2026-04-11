import { basename } from "node:path";
import * as Lark from "@larksuiteoapi/node-sdk";
import { createLogger } from "@openmantis/common/logger";
import { toAmr, toOpus } from "./convert";
import type { TtsChannelContext, TtsConfig, WecomClientLike } from "./types";

const logger = createLogger("tts");

export interface UploadResult {
	ok: boolean;
	mode?: "voice" | "file";
	channelMsgId?: string;
	error?: string;
}

async function uploadToFeishu(
	audio: { filePath: string; durationMs: number },
	chatId: string,
	channelType: string,
	config: TtsConfig,
): Promise<UploadResult> {
	const appName = channelType.startsWith("feishu:") ? channelType.slice(7) : undefined;
	const feishuApp = config.feishu?.find((a) => a.name === appName) ?? config.feishu?.[0];
	if (!feishuApp?.appId || !feishuApp?.appSecret) {
		return { ok: false, error: "feishu config missing" };
	}
	const client = new Lark.Client({
		appId: feishuApp.appId,
		appSecret: feishuApp.appSecret,
	});

	const opusPath = await toOpus(audio.filePath);
	const sendVoice = opusPath !== null;
	const filePath = opusPath ?? audio.filePath;
	const file = Bun.file(filePath);
	const buffer = Buffer.from(await file.arrayBuffer());
	const filename = basename(filePath);

	logger.debug(
		`[tts] feishu upload start: chatId=${chatId}, durationMs=${audio.durationMs}, opus=${sendVoice}`,
	);

	try {
		if (sendVoice) {
			const uploadRes = await client.im.v1.file.create({
				data: {
					file_type: "opus" as any,
					file_name: filename,
					file: buffer,
					duration: audio.durationMs,
				} as any,
			});
			const fileKey = uploadRes?.file_key;
			if (!fileKey) return { ok: false, error: "feishu upload missing file_key" };

			const sendRes = await client.im.v1.message.create({
				params: { receive_id_type: "chat_id" },
				data: {
					receive_id: chatId,
					msg_type: "audio",
					content: JSON.stringify({ file_key: fileKey }),
				},
			});
			logger.info(
				`[tts] feishu voice sent: chatId=${chatId}, durationMs=${audio.durationMs}, msgId=${sendRes.data?.message_id}`,
			);
			return { ok: true, mode: "voice", channelMsgId: sendRes.data?.message_id };
		}

		const uploadRes = await client.im.v1.file.create({
			data: {
				file_type: "stream" as any,
				file_name: filename,
				file: buffer,
				duration: audio.durationMs,
			} as any,
		});
		const fileKey = uploadRes?.file_key;
		if (!fileKey) return { ok: false, error: "feishu upload missing file_key" };

		const sendRes = await client.im.v1.message.create({
			params: { receive_id_type: "chat_id" },
			data: {
				receive_id: chatId,
				msg_type: "file",
				content: JSON.stringify({ file_key: fileKey }),
			},
		});
		logger.info(
			`[tts] feishu file sent (opus unavailable): chatId=${chatId}, msgId=${sendRes.data?.message_id}`,
		);
		return { ok: true, mode: "file", channelMsgId: sendRes.data?.message_id };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `feishu upload failed: ${message}` };
	}
}

async function uploadToWecom(
	audio: { filePath: string; durationMs: number },
	chatId: string,
	client: WecomClientLike,
): Promise<UploadResult> {

	// WeCom voice messages require AMR-NB format (per official docs).
	const amrPath = await toAmr(audio.filePath);
	const sendVoice = amrPath !== null;
	const filePath = amrPath ?? audio.filePath;
	const file = Bun.file(filePath);
	const buffer = Buffer.from(await file.arrayBuffer());
	const filename = basename(filePath);
	const mediaType = sendVoice ? ("voice" as const) : ("file" as const);

	logger.debug(
		`[tts] wecom upload start: chatId=${chatId}, durationMs=${audio.durationMs}, amr=${sendVoice}`,
	);

	try {
		const uploadResult = await client.uploadMedia(buffer, { type: mediaType, filename });
		await client.sendMediaMessage(chatId, mediaType, uploadResult.media_id);
		logger.info(`[tts] wecom ${sendVoice ? "voice" : "file"} sent: chatId=${chatId}`);
		return { ok: true, mode: sendVoice ? "voice" : "file" };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `wecom upload failed: ${message}` };
	}
}

export async function uploadToChannel(
	channel: TtsChannelContext,
	audio: { filePath: string; durationMs: number },
	config: TtsConfig,
	wecomClient?: WecomClientLike | null,
): Promise<UploadResult> {
	if (channel.channelType.startsWith("feishu")) {
		const prefix = `${channel.channelType}-`;
		const chatId = channel.channelId.startsWith(prefix)
			? channel.channelId.slice(prefix.length)
			: channel.channelId.replace(/^feishu[^-]*-/, "");
		return uploadToFeishu(audio, chatId, channel.channelType, config);
	}
	if (channel.channelType === "wecom") {
		if (!wecomClient) return { ok: false, error: "wecom client unavailable" };
		const chatId = channel.channelId.startsWith("wecom-")
			? channel.channelId.slice("wecom-".length)
			: channel.channelId;
		return uploadToWecom(audio, chatId, wecomClient);
	}
	logger.debug(`[tts] uploadToChannel: unsupported channel ${channel.channelType}`);
	return { ok: false, error: `unsupported channel ${channel.channelType}` };
}
