/**
 * QQ 大文件分片上传
 *
 * 流程：
 * 1. upload_prepare → 获取 upload_id + block_size + 预签名 COS 链接
 * 2. 并行 PUT 分片到 COS 预签名 URL + upload_part_finish 通知平台
 * 3. complete_upload → 获取 file_info（可直接用于 msg_type=7 发送）
 *
 * 分片上传绕过了简单上传 API 的 IP 白名单限制，因为实际数据传到 COS。
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename } from "node:path";
import { createLogger } from "@openmantis/common/logger";
import type { QQApi } from "./api";
import type { FileHashes, QQMediaResult, UploadPart } from "./types";

const logger = createLogger("channel-qq");

/** 文件前 10002432 Bytes 的 MD5（QQ 协议定义） */
const MD5_10M_SIZE = 10_002_432;

/** 单个分片上传超时 5 分钟 */
const PART_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** 分片上传最大重试次数 */
const PART_UPLOAD_MAX_RETRIES = 2;

/** 分片并发上限 */
const MAX_CONCURRENCY = 10;

// ---- 哈希计算 ----

/** 流式计算文件的 md5、sha1、md5_10m，只遍历一次 */
async function computeFileHashes(filePath: string, fileSize: number): Promise<FileHashes> {
	return new Promise((resolve, reject) => {
		const md5 = createHash("md5");
		const sha1 = createHash("sha1");
		const md5_10m = createHash("md5");

		let bytesRead = 0;
		const need10m = fileSize > MD5_10M_SIZE;

		const stream = createReadStream(filePath);
		stream.on("data", (chunk: Buffer | string) => {
			if (!Buffer.isBuffer(chunk)) return;
			md5.update(chunk);
			sha1.update(chunk);
			if (need10m) {
				const remaining = MD5_10M_SIZE - bytesRead;
				if (remaining > 0) {
					md5_10m.update(remaining >= chunk.length ? chunk : chunk.subarray(0, remaining));
				}
			}
			bytesRead += chunk.length;
		});
		stream.on("end", () => {
			const md5Hex = md5.digest("hex");
			resolve({
				md5: md5Hex,
				sha1: sha1.digest("hex"),
				md5_10m: need10m ? md5_10m.digest("hex") : md5Hex,
			});
		});
		stream.on("error", reject);
	});
}

// ---- 分片读取 ----

async function readFileChunk(filePath: string, offset: number, length: number): Promise<Buffer> {
	const fd = await open(filePath, "r");
	try {
		const buf = Buffer.alloc(length);
		const { bytesRead } = await fd.read(buf, 0, length, offset);
		return bytesRead < length ? buf.subarray(0, bytesRead) : buf;
	} finally {
		await fd.close();
	}
}

// ---- PUT 到 COS 预签名 URL ----

async function putToPresignedUrl(url: string, data: Buffer, label: string): Promise<void> {
	let lastError: Error | null = null;
	for (let attempt = 0; attempt <= PART_UPLOAD_MAX_RETRIES; attempt++) {
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), PART_UPLOAD_TIMEOUT_MS);
			try {
				const blob = new Blob([new Uint8Array(data)]);
				const res = await fetch(url, {
					method: "PUT",
					body: blob,
					headers: { "Content-Length": String(data.length) },
					signal: controller.signal,
				});
				if (!res.ok) {
					const body = await res.text().catch(() => "");
					throw new Error(`COS PUT failed: ${res.status} ${body}`);
				}
				return;
			} finally {
				clearTimeout(timer);
			}
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (lastError.name === "AbortError") {
				lastError = new Error(`${label} upload timeout`);
			}
			if (attempt < PART_UPLOAD_MAX_RETRIES) {
				const delay = 1000 * 2 ** attempt;
				logger.warn(`[qq:upload] ${label} attempt ${attempt + 1} failed, retry in ${delay}ms`);
				await new Promise((r) => setTimeout(r, delay));
			}
		}
	}
	throw lastError!;
}

// ---- 并发控制 ----

async function runWithConcurrency(
	tasks: Array<() => Promise<void>>,
	maxConcurrent: number,
): Promise<void> {
	for (let i = 0; i < tasks.length; i += maxConcurrent) {
		await Promise.all(tasks.slice(i, i + maxConcurrent).map((fn) => fn()));
	}
}

// ---- 主入口 ----

/**
 * 分片上传文件到 QQ（C2C 或群聊）并获取 file_info。
 *
 * @returns QQMediaResult，其中 file_info 可直接用于 msg_type=7 发消息
 */
export async function chunkedUpload(
	api: QQApi,
	targetId: string,
	isGroup: boolean,
	filePath: string,
	fileType: number,
): Promise<QQMediaResult> {
	const fileName = basename(filePath);
	const fileStat = await stat(filePath);
	const fileSize = fileStat.size;

	logger.info(
		`[qq:upload] starting chunked upload: file=${fileName}, size=${(fileSize / 1024 / 1024).toFixed(1)}MB, type=${fileType}`,
	);

	// 1. 计算哈希
	const hashes = await computeFileHashes(filePath, fileSize);
	logger.debug(`[qq:upload] hashes: md5=${hashes.md5}, sha1=${hashes.sha1}`);

	// 2. upload_prepare
	const prepare = isGroup
		? await api.groupUploadPrepare(targetId, fileType, fileName, fileSize, hashes)
		: await api.c2cUploadPrepare(targetId, fileType, fileName, fileSize, hashes);

	const { upload_id, parts } = prepare;
	const blockSize = Number(prepare.block_size);
	const concurrency = Math.min(
		prepare.concurrency ? Number(prepare.concurrency) : 1,
		MAX_CONCURRENCY,
	);

	logger.info(
		`[qq:upload] prepared: upload_id=${upload_id}, parts=${parts.length}, block=${(blockSize / 1024).toFixed(0)}KB, concurrency=${concurrency}`,
	);

	// 3. 并行上传分片
	const uploadPart = async (part: UploadPart) => {
		const offset = (part.index - 1) * blockSize;
		const length = Math.min(blockSize, fileSize - offset);
		const buf = await readFileChunk(filePath, offset, length);
		const md5Hex = createHash("md5").update(buf).digest("hex");
		const label = `part ${part.index}/${parts.length}`;

		logger.debug(`[qq:upload] ${label}: uploading ${(length / 1024).toFixed(0)}KB`);
		await putToPresignedUrl(part.presigned_url, buf, label);

		if (isGroup) {
			await api.groupUploadPartFinish(targetId, upload_id, part.index, length, md5Hex);
		} else {
			await api.c2cUploadPartFinish(targetId, upload_id, part.index, length, md5Hex);
		}
		logger.debug(`[qq:upload] ${label}: done`);
	};

	await runWithConcurrency(
		parts.map((part) => () => uploadPart(part)),
		concurrency,
	);

	// 4. 完成上传
	const result = isGroup
		? await api.groupCompleteUpload(targetId, upload_id)
		: await api.c2cCompleteUpload(targetId, upload_id);

	logger.info(
		`[qq:upload] completed: file_uuid=${result.file_uuid}, ttl=${result.ttl}s`,
	);

	return result;
}
