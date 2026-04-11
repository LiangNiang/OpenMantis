import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createLogger } from "@openmantis/common/logger";
import { TMP_DIR } from "@openmantis/common/paths";

const logger = createLogger("core/whisper");

import { transcribeAudio } from "./api";
import { prepareAudio } from "./audio-compress";
import { mergeChunkResults } from "./output";
import type { TranscribeOptions, TranscribeResult, WhisperApiResponse } from "./types";

export async function transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
	const { input, language, apiKey, baseUrl } = options;

	if (!existsSync(input)) {
		throw new Error(`文件不存在: ${input}`);
	}

	const tmpDir = `${TMP_DIR}/whisper-${Date.now()}`;
	mkdirSync(tmpDir, { recursive: true });

	try {
		const { chunks } = await prepareAudio(input, tmpDir);
		logger.debug(`[whisper:transcribe] prepared ${chunks.length} chunk(s) for: ${input}`);

		const results: { response: WhisperApiResponse; offsetSec: number }[] = [];

		for (const [i, chunk] of chunks.entries()) {
			logger.debug(
				`[whisper:transcribe] transcribing chunk ${i + 1}/${chunks.length} (offset: ${chunk.offsetSec}s)`,
			);

			try {
				const response = await transcribeAudio(chunk.path, { apiKey, baseUrl, language });
				results.push({ response, offsetSec: chunk.offsetSec });
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.warn(`[whisper:transcribe] chunk ${i + 1} failed: ${msg}`);
			}
		}

		if (results.length === 0) {
			throw new Error("所有音频片段转录均失败");
		}

		const { segments, text, language: detectedLang, duration } = mergeChunkResults(results);

		logger.debug(
			`[whisper:transcribe] done: ${segments.length} segments, ${duration.toFixed(1)}s, lang=${detectedLang}`,
		);

		return { text, segments, language: detectedLang, duration };
	} finally {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch (err) {
			logger.warn(`[whisper:transcribe] tmp cleanup failed: ${err}`);
		}
	}
}
