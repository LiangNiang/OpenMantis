import { statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createLogger } from "@openmantis/common/logger";
import { $ } from "bun";

const logger = createLogger("core/whisper");

import { MAX_FILE_SIZE } from "./types";

async function getAudioDuration(filePath: string): Promise<number> {
	const result = await $`ffprobe -v quiet -show_entries format=duration -of csv=p=0 ${filePath}`
		.quiet()
		.nothrow();

	if (result.exitCode !== 0) {
		throw new Error("ffprobe 获取音频时长失败");
	}

	const duration = Number.parseFloat(result.stdout.toString().trim());
	if (Number.isNaN(duration)) {
		throw new Error("ffprobe 返回无效时长");
	}
	return duration;
}

async function compressAudio(filePath: string, tmpDir: string): Promise<string> {
	const outName = `${basename(filePath, extname(filePath))}_compressed.ogg`;
	const outPath = join(tmpDir, outName);

	const result = await $`ffmpeg -i ${filePath} -c:a libopus -b:a 32k ${outPath} -y`
		.quiet()
		.nothrow();

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString();
		throw new Error(`ffmpeg 压缩失败 (exit ${result.exitCode}): ${stderr}`);
	}

	return outPath;
}

async function splitAudio(
	filePath: string,
	tmpDir: string,
	chunkDurationSec: number,
): Promise<{ path: string; offsetSec: number }[]> {
	const totalDuration = await getAudioDuration(filePath);
	const ext = extname(filePath);
	const base = basename(filePath, ext);
	const chunks: { path: string; offsetSec: number }[] = [];
	const overlapSec = 1;

	let offset = 0;
	let index = 0;

	while (offset < totalDuration) {
		const chunkPath = join(tmpDir, `${base}_chunk${index}${ext}`);
		const result =
			await $`ffmpeg -i ${filePath} -ss ${offset} -t ${chunkDurationSec} -c copy ${chunkPath} -y`
				.quiet()
				.nothrow();

		if (result.exitCode !== 0) {
			logger.warn(`[whisper:compress] chunk ${index} split failed, skipping`);
		} else {
			chunks.push({ path: chunkPath, offsetSec: offset });
		}

		offset += chunkDurationSec - overlapSec;
		index++;
	}

	if (chunks.length === 0) {
		throw new Error("音频分片全部失败");
	}

	return chunks;
}

export interface PreparedAudio {
	chunks: { path: string; offsetSec: number }[];
}

export async function prepareAudio(audioPath: string, tmpDir: string): Promise<PreparedAudio> {
	const fileSize = statSync(audioPath).size;
	logger.debug(`[whisper:compress] file size: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);

	if (fileSize <= MAX_FILE_SIZE) {
		return { chunks: [{ path: audioPath, offsetSec: 0 }] };
	}

	logger.debug("[whisper:compress] file too large, compressing to ogg/opus");
	const compressed = await compressAudio(audioPath, tmpDir);
	const compressedSize = statSync(compressed).size;
	logger.debug(
		`[whisper:compress] compressed size: ${(compressedSize / 1024 / 1024).toFixed(1)}MB`,
	);

	if (compressedSize <= MAX_FILE_SIZE) {
		return { chunks: [{ path: compressed, offsetSec: 0 }] };
	}

	logger.debug("[whisper:compress] still too large, splitting into chunks");
	const duration = await getAudioDuration(compressed);
	const chunkDurationSec = Math.floor((MAX_FILE_SIZE / compressedSize) * duration * 0.9);
	const minChunkDuration = 30;
	const effectiveChunkDuration = Math.max(chunkDurationSec, minChunkDuration);

	const chunks = await splitAudio(compressed, tmpDir, effectiveChunkDuration);
	return { chunks };
}
