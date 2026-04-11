import { createLogger } from "@openmantis/common/logger";
import OpenAI from "openai";

const logger = createLogger("core/whisper");

import type { WhisperApiResponse, WhisperApiSegment } from "./types";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

export async function transcribeAudio(
	filePath: string,
	options: {
		apiKey: string;
		baseUrl?: string;
		language?: string;
	},
): Promise<WhisperApiResponse> {
	const client = new OpenAI({
		apiKey: options.apiKey,
		...(options.baseUrl && { baseURL: options.baseUrl }),
	});

	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		if (attempt > 0) {
			const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
			logger.debug(`[whisper:api] retry ${attempt}/${MAX_RETRIES} after ${delay}ms`);
			await new Promise((r) => setTimeout(r, delay));
		}

		try {
			const file = Bun.file(filePath);
			const response = await client.audio.transcriptions.create({
				file,
				model: "whisper-1",
				response_format: "verbose_json",
				timestamp_granularities: ["segment"],
				...(options.language && { language: options.language }),
			});

			// OpenAI SDK returns a TranscriptionVerbose when response_format is
			// "verbose_json", which includes language/duration/segments fields.
			const r = response as unknown as Record<string, unknown>;
			return {
				text: response.text,
				language: (r.language as string) ?? "",
				duration: (r.duration as number) ?? 0,
				segments: (r.segments as WhisperApiSegment[]) ?? [],
			};
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			logger.warn(`[whisper:api] attempt ${attempt + 1} failed: ${lastError.message}`);

			// Don't retry on client errors (4xx) except 429
			if (
				err instanceof OpenAI.APIError &&
				err.status &&
				err.status >= 400 &&
				err.status < 500 &&
				err.status !== 429
			) {
				throw lastError;
			}
		}
	}

	throw lastError ?? new Error("Whisper API transcription failed");
}
