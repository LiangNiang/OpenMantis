import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FileAttachment } from "@openmantis/common/types/channels";
import { createLogger } from "@openmantis/common/logger";
import { UPLOADS_DIR } from "@openmantis/common/paths";

const logger = createLogger("channel-qq");
import type { ParsedQQAttachment } from "./types";

const DEFAULT_UPLOAD_DIR = UPLOADS_DIR;
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Download QQ media attachments via their direct URLs.
 * QQ Bot API provides direct download URLs (unlike Feishu/WeCom SDKs).
 */
export async function downloadQQAttachments(
	attachments: ParsedQQAttachment[],
	options?: { uploadDir?: string; maxFileSize?: number },
): Promise<FileAttachment[]> {
	if (attachments.length === 0) return [];

	const uploadDir = options?.uploadDir ?? DEFAULT_UPLOAD_DIR;
	mkdirSync(uploadDir, { recursive: true });

	const maxFileSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
	const downloads = attachments.map((att) => downloadOne(att, uploadDir, maxFileSize));
	const settled = await Promise.allSettled(downloads);

	const results: FileAttachment[] = [];
	for (const [i, result] of settled.entries()) {
		if (result.status === "fulfilled" && result.value) {
			results.push(result.value);
		} else if (result.status === "rejected") {
			logger.warn(`[qq] failed to download attachment ${attachments[i]?.url}:`, result.reason);
		}
	}
	return results;
}

async function downloadOne(
	attachment: ParsedQQAttachment,
	uploadDir: string,
	maxFileSize: number,
): Promise<FileAttachment | null> {
	const res = await fetch(attachment.url);
	if (!res.ok) {
		logger.warn(`[qq] attachment download failed: ${res.status} ${attachment.url}`);
		return null;
	}

	const buffer = Buffer.from(await res.arrayBuffer());

	if (buffer.length > maxFileSize) {
		logger.warn(`[qq] attachment exceeds ${maxFileSize} bytes (${buffer.length}), skipping`);
		return null;
	}

	const sanitizedName = attachment.filename.replace(/[<>:"/\\|?*]/g, "_");
	const filePath = resolve(join(uploadDir, `${Date.now()}-${sanitizedName}`));
	await Bun.write(filePath, buffer);

	logger.debug(
		`[qq] downloaded attachment: ${attachment.contentType} -> ${filePath}, size=${buffer.length}`,
	);
	return {
		path: filePath,
		fileName: attachment.filename,
		mimeType: attachment.contentType,
		size: buffer.length,
	};
}
