import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type * as Lark from "@larksuiteoapi/node-sdk";
import type { FileAttachment } from "@openmantis/common/types/channels";
import { createLogger } from "@openmantis/common/logger";
import { UPLOADS_DIR } from "@openmantis/common/paths";
import type { ParsedAttachment } from "./types";

const logger = createLogger("channel-feishu");

interface DownloadOptions {
	uploadDir?: string;
	maxFileSize?: number;
	/** Per-attachment download timeout in ms (default: 30s) */
	timeoutMs?: number;
}

const DEFAULT_UPLOAD_DIR = UPLOADS_DIR;
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_TIMEOUT_MS = 30_000; // 30s per attachment

export async function downloadAttachments(
	client: Lark.Client,
	messageId: string,
	attachments: ParsedAttachment[],
	options?: DownloadOptions,
): Promise<FileAttachment[]> {
	if (attachments.length === 0) return [];

	const uploadDir = options?.uploadDir ?? DEFAULT_UPLOAD_DIR;
	mkdirSync(uploadDir, { recursive: true });

	const downloads = attachments.map((att) =>
		downloadOneAttachment(client, messageId, att, options),
	);
	const settled = await Promise.allSettled(downloads);

	const results: FileAttachment[] = [];
	for (const [i, result] of settled.entries()) {
		if (result.status === "fulfilled" && result.value) {
			results.push(result.value);
		} else if (result.status === "rejected") {
			logger.warn(`[feishu] failed to download attachment ${attachments[i]?.key}:`, result.reason);
		}
	}
	return results;
}

export async function downloadOneAttachment(
	client: Lark.Client,
	messageId: string,
	attachment: ParsedAttachment,
	options?: DownloadOptions,
): Promise<FileAttachment | null> {
	const uploadDir = options?.uploadDir ?? DEFAULT_UPLOAD_DIR;
	const maxFileSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	const res = await Promise.race([
		client.im.v1.messageResource.get({
			path: { message_id: messageId, file_key: attachment.key },
			params: { type: attachment.resourceType },
		}),
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error("download timed out")), timeoutMs),
		),
	]);

	const stream = res.getReadableStream();
	const chunks: Buffer[] = [];
	let totalSize = 0;
	for await (const chunk of stream) {
		totalSize += chunk.length;
		if (totalSize > maxFileSize) {
			logger.warn(
				`[feishu] attachment ${attachment.key} exceeds ${maxFileSize} bytes, skipping`,
			);
			return null;
		}
		chunks.push(Buffer.from(chunk));
	}
	const buffer = Buffer.concat(chunks);

	const contentType = res.headers?.["content-type"] as string | undefined;
	const mimeType = contentType || undefined;

	const sanitizedName = attachment.name.replace(/[<>:"/\\|?*]/g, "_");
	const filePath = resolve(join(uploadDir, `${Date.now()}-${sanitizedName}`));
	await Bun.write(filePath, buffer);

	logger.debug(
		`[feishu] downloaded attachment: ${attachment.key} → ${filePath}, size=${buffer.length}`,
	);
	return {
		path: filePath,
		fileName: attachment.name,
		mimeType,
		size: buffer.length,
	};
}
