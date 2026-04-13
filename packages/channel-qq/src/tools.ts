import { basename, extname } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { createLogger } from "@openmantis/common/logger";
import { QQApi } from "./api";
import { chunkedUpload } from "./chunked-upload";
import type { QQConfig } from "./types";

const logger = createLogger("channel-qq");

/** 分片上传支持到 100 MB */
const FILE_SIZE_LIMIT = 100 * 1024 * 1024;

function isImageMimeType(mimeType: string | undefined): boolean {
	return typeof mimeType === "string" && mimeType.startsWith("image/");
}

/**
 * Infer QQ file_type from extension:
 * 1=image, 2=video, 3=audio, 4=file
 */
function inferQQFileType(filename: string): number {
	const ext = extname(filename).replace(/^\./, "").toLowerCase();
	const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
	const videoExts = ["mp4", "avi", "mov", "mkv"];
	const audioExts = ["silk", "wav", "mp3", "flac", "ogg", "opus"];

	if (imageExts.includes(ext)) return 1;
	if (videoExts.includes(ext)) return 2;
	if (audioExts.includes(ext)) return 3;
	return 4;
}

/**
 * 使用分片上传发送媒体文件，然后通过 msg_type=7 发送消息。
 * 分片上传绕过了简单上传的 IP 白名单限制。
 */
async function uploadAndSend(
	api: QQApi,
	isGroup: boolean,
	targetId: string,
	filePath: string,
	fileType: number,
	msgId?: string,
): Promise<{ success: boolean; fileUuid?: string; error?: string; note?: string }> {
	try {
		const result = await chunkedUpload(api, targetId, isGroup, filePath, fileType);

		// 用 msg_type=7 + file_info 发送媒体消息
		const params = {
			msg_type: 7 as const,
			media: { file_info: result.file_info },
			...(msgId ? { msg_id: msgId } : {}),
		};
		if (isGroup) {
			await api.sendGroupMessage(targetId, params);
		} else {
			await api.sendC2CMessage(targetId, params);
		}
		return { success: true, fileUuid: result.file_uuid, note: "文件已发送" };
	} catch (err: any) {
		logger.error("[qq:upload] upload failed:", err);
		return { success: false, error: `发送文件异常: ${err?.message ?? String(err)}` };
	}
}

export function createQQTools(config: QQConfig, channelId: string, msgId?: string) {
	const api = new QQApi(config);
	const isGroup = channelId.startsWith("qq-group-");
	const targetId = isGroup
		? channelId.slice("qq-group-".length)
		: channelId.slice("qq-c2c-".length);

	const qq_send_image = tool({
		description: "将本地图片文件上传到 QQ 并发送给当前用户/群。支持 PNG、JPG 格式。",
		inputSchema: z.object({
			path: z.string().describe("本地图片文件路径（绝对路径或相对项目根目录的路径）"),
		}),
		execute: async ({ path }) => {
			const file = Bun.file(path);
			if (!(await file.exists())) {
				return { success: false, error: `文件不存在: ${path}` };
			}
			if (!isImageMimeType(file.type)) {
				return {
					success: false,
					error: `该文件不是图片（MIME: ${file.type || "未知"}），请使用 qq_send_file 发送文件。`,
				};
			}
			if (file.size > FILE_SIZE_LIMIT) {
				return {
					success: false,
					error: `图片文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），限制 100 MB。`,
				};
			}
			return uploadAndSend(api, isGroup, targetId, path, 1, msgId);
		},
	});

	const qq_send_file = tool({
		description:
			"将本地文件上传到 QQ 并发送给当前用户/群。支持图片、视频、音频和其他文件格式（最大 100 MB）。",
		inputSchema: z.object({
			path: z.string().describe("本地文件路径（绝对路径或相对项目根目录的路径）"),
			filename: z.string().optional().describe("覆盖显示名称，默认使用文件原始名"),
		}),
		execute: async ({ path, filename }) => {
			const file = Bun.file(path);
			if (!(await file.exists())) {
				return { success: false, error: `文件不存在: ${path}` };
			}
			if (file.size > FILE_SIZE_LIMIT) {
				return {
					success: false,
					error: `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），限制 100 MB。`,
				};
			}
			const displayName = filename ?? basename(path);
			const fileType = inferQQFileType(displayName);
			return uploadAndSend(api, isGroup, targetId, path, fileType, msgId);
		},
	});

	return { qq_send_image, qq_send_file };
}
