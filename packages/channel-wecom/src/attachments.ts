import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WSClient } from "@wecom/aibot-node-sdk";
import type { FileAttachment } from "@openmantis/common/types/channels";
import { createLogger } from "@openmantis/common/logger";
import { UPLOADS_DIR } from "@openmantis/common/paths";

const logger = createLogger("channel-wecom");
import type { ParsedWeComAttachment } from "./types";

const DEFAULT_UPLOAD_DIR = UPLOADS_DIR;

const EXTENSION_MIME_MAP: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".mp4": "video/mp4",
	".avi": "video/x-msvideo",
	".mov": "video/quicktime",
};

function guessMimeType(resourceType: string, fileName: string): string | undefined {
	const dotIndex = fileName.lastIndexOf(".");
	const ext = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
	if (EXTENSION_MIME_MAP[ext]) return EXTENSION_MIME_MAP[ext];

	switch (resourceType) {
		case "image":
			return "image/png";
		case "video":
			return "video/mp4";
		default:
			return undefined;
	}
}
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Download WeCom media attachments using the SDK's built-in
 * downloadFile method which handles both download and AES decryption.
 */
export async function downloadWeComAttachments(
	client: WSClient,
	attachments: ParsedWeComAttachment[],
	options?: { uploadDir?: string; maxFileSize?: number },
): Promise<FileAttachment[]> {
	if (attachments.length === 0) return [];

	const uploadDir = options?.uploadDir ?? DEFAULT_UPLOAD_DIR;
	mkdirSync(uploadDir, { recursive: true });

	const downloads = attachments.map((att) =>
		downloadOne(client, att, uploadDir, options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE),
	);
	const settled = await Promise.allSettled(downloads);

	const results: FileAttachment[] = [];
	for (const [i, result] of settled.entries()) {
		if (result.status === "fulfilled" && result.value) {
			results.push(result.value);
		} else if (result.status === "rejected") {
			logger.warn(`[wecom] failed to download attachment ${attachments[i]?.url}:`, result.reason);
		}
	}
	return results;
}

async function downloadOne(
	client: WSClient,
	attachment: ParsedWeComAttachment,
	uploadDir: string,
	maxFileSize: number,
): Promise<FileAttachment | null> {
	const { buffer, filename } = await client.downloadFile(attachment.url, attachment.aeskey);

	if (buffer.length > maxFileSize) {
		logger.warn(`[wecom] attachment exceeds ${maxFileSize} bytes (${buffer.length}), skipping`);
		return null;
	}

	const sanitizedName = (filename || attachment.name).replace(/[<>:"/\\|?*]/g, "_");
	const filePath = resolve(join(uploadDir, `${Date.now()}-${sanitizedName}`));
	await Bun.write(filePath, buffer);

	logger.debug(
		`[wecom] downloaded attachment: ${attachment.resourceType} -> ${filePath}, size=${buffer.length}`,
	);
	return {
		path: filePath,
		fileName: filename || attachment.name,
		mimeType: guessMimeType(attachment.resourceType, filename || attachment.name),
		size: buffer.length,
	};
}
