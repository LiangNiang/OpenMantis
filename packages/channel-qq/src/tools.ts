import { basename, extname } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { QQApi } from "./api";
import type { QQConfig } from "./types";

const IMAGE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB
const FILE_SIZE_LIMIT = 30 * 1024 * 1024; // 30 MB

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

export function createQQTools(config: QQConfig, channelId: string) {
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
			const exists = await file.exists();
			if (!exists) {
				return { success: false, error: `文件不存在: ${path}` };
			}

			const mimeType = file.type;
			if (!isImageMimeType(mimeType)) {
				return {
					success: false,
					error: `该文件不是图片（MIME: ${mimeType || "未知"}），请使用 qq_send_file 发送文件。`,
				};
			}

			if (file.size > IMAGE_SIZE_LIMIT) {
				return {
					success: false,
					error: `图片文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），QQ 限制 10 MB。`,
				};
			}

			try {
				const buffer = Buffer.from(await file.arrayBuffer());
				const fileData = buffer.toString("base64");

				const uploadFn = isGroup ? api.uploadGroupMedia.bind(api) : api.uploadC2CMedia.bind(api);

				const result = await uploadFn(targetId, 1, { fileData }, true);

				return {
					success: true,
					fileUuid: result.file_uuid,
					note: "图片已发送",
				};
			} catch (err: any) {
				return {
					success: false,
					error: `发送图片异常: ${err?.message ?? String(err)}`,
				};
			}
		},
	});

	const qq_send_file = tool({
		description: "将本地文件上传到 QQ 并发送给当前用户/群。支持图片、视频、音频和其他文件格式。",
		inputSchema: z.object({
			path: z.string().describe("本地文件路径（绝对路径或相对项目根目录的路径）"),
			filename: z.string().optional().describe("覆盖显示名称，默认使用文件原始名"),
		}),
		execute: async ({ path, filename }) => {
			const file = Bun.file(path);
			const exists = await file.exists();
			if (!exists) {
				return { success: false, error: `文件不存在: ${path}` };
			}

			const displayName = filename ?? basename(path);

			if (file.size > FILE_SIZE_LIMIT) {
				return {
					success: false,
					error: `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），QQ 限制 30 MB。`,
				};
			}

			const fileType = inferQQFileType(displayName);

			try {
				const buffer = Buffer.from(await file.arrayBuffer());
				const fileData = buffer.toString("base64");

				const uploadFn = isGroup ? api.uploadGroupMedia.bind(api) : api.uploadC2CMedia.bind(api);

				const result = await uploadFn(targetId, fileType, { fileData }, true);

				return {
					success: true,
					fileUuid: result.file_uuid,
					note: `文件「${displayName}」已发送`,
				};
			} catch (err: any) {
				return {
					success: false,
					error: `发送文件异常: ${err?.message ?? String(err)}`,
				};
			}
		},
	});

	return { qq_send_image, qq_send_file };
}
