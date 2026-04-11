import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { OpenMantisConfig } from "@openmantis/common/config/schema";
import { createLogger } from "@openmantis/common/logger";
import { WORKSPACE_DIR } from "@openmantis/common/paths";
import { tool } from "ai";
import { $ } from "bun";
import { z } from "zod";
import { generateSrt, transcribe } from "../lib/whisper";

const logger = createLogger("core/tools");

const VIDEO_EXTENSIONS = new Set([
	".mp4",
	".mkv",
	".avi",
	".mov",
	".flv",
	".wmv",
	".rmvb",
	".webm",
]);

function resolveApiKey(config?: OpenMantisConfig): string | undefined {
	return config?.whisper?.apiKey;
}

async function extractAudioFromVideo(videoPath: string): Promise<string> {
	const outPath = `${videoPath}.wav`;
	const result = await $`ffmpeg -i ${videoPath} -vn -acodec pcm_s16le -ar 16000 -ac 1 ${outPath} -y`
		.quiet()
		.nothrow();

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString();
		throw new Error(`ffmpeg 音频提取失败 (exit ${result.exitCode}): ${stderr}`);
	}
	return outPath;
}

export function createWhisperTools(config?: OpenMantisConfig) {
	return {
		audio_transcribe: tool({
			description:
				"转录本地音频/视频文件为文字。传入本地文件路径，自动处理音频提取、压缩、分片。返回纯文本、SRT字幕路径和时间戳数据。不负责下载，请先用其他工具下载文件。",
			inputSchema: z.object({
				input: z.string().describe("本地音频或视频文件路径"),
				language: z.string().optional().describe("语言代码（如 zh、en、ja），不传则自动检测"),
				outputDir: z.string().optional().describe("输出目录，默认 workspace/"),
			}),
			execute: async ({ input, language, outputDir }) => {
				logger.debug(`[tool:whisper] transcribing: ${input}`);

				const apiKey = resolveApiKey(config);
				if (!apiKey) {
					return {
						error: "Whisper API key 未配置。请在 config 中设置 whisper.apiKey 或 apiKey。",
					};
				}

				if (!existsSync(input)) {
					return { error: `文件不存在: ${input}` };
				}

				try {
					// Video → audio extraction at tool level
					let audioPath = input;
					const ext = extname(input).toLowerCase();
					if (VIDEO_EXTENSIONS.has(ext)) {
						logger.debug(`[tool:whisper] extracting audio from video: ${input}`);
						audioPath = await extractAudioFromVideo(input);
					}

					const result = await transcribe({
						input: audioPath,
						language,
						apiKey,
						baseUrl: config?.whisper?.baseUrl,
					});

					// Save output files at tool level
					const outDir = outputDir ?? WORKSPACE_DIR;
					const inputBaseName = basename(input, extname(input))
						.replace(/[^\w\u4e00-\u9fff-]/g, "_")
						.slice(0, 80);
					const baseName = `${inputBaseName}_transcription`;

					const srtPath = join(outDir, `${baseName}.srt`);
					const jsonPath = join(outDir, `${baseName}.json`);
					await Bun.write(srtPath, generateSrt(result.segments));
					await Bun.write(jsonPath, JSON.stringify(result.segments, null, 2));

					return {
						text: result.text,
						srtPath,
						jsonPath,
						language: result.language,
						duration: `${result.duration.toFixed(1)}s`,
						segmentCount: result.segments.length,
					};
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					logger.error(`[tool:whisper] transcription failed: ${message}`);
					return { error: message };
				}
			},
		}),
	};
}
