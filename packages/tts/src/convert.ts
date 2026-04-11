import { $ } from "bun";
import { createLogger } from "@openmantis/common/logger";

const logger = createLogger("tts");

let ffmpegMissing = false;

/**
 * Convert a WAV file to Opus using ffmpeg. Returns the new file path,
 * or null if ffmpeg is missing or conversion fails. The "missing" state
 * is cached for the process lifetime to avoid re-spawning.
 */
export async function toOpus(wavPath: string): Promise<string | null> {
	if (ffmpegMissing) return null;
	const opusPath = wavPath.replace(/\.wav$/i, ".opus");

	const result = await $`ffmpeg -y -i ${wavPath} -acodec libopus -ac 1 -ar 16000 ${opusPath}`
		.quiet()
		.nothrow();

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString();
		if (/not found|ENOENT|command not found/i.test(stderr)) {
			ffmpegMissing = true;
			logger.debug("[tts] ffmpeg not found; opus conversion disabled for this process");
		} else {
			logger.debug(
				`[tts] ffmpeg conversion failed (exit ${result.exitCode}): ${stderr.slice(0, 300)}`,
			);
		}
		return null;
	}
	logger.debug(`[tts] ffmpeg wav→opus ok: ${wavPath} → ${opusPath}`);
	return opusPath;
}

/**
 * Convert a WAV file to AMR-NB (8 kHz mono, libopencore_amrnb) using ffmpeg.
 * Required by WeCom voice messages — only AMR is accepted there.
 * Returns null if ffmpeg or the AMR encoder is missing or conversion fails.
 */
export async function toAmr(wavPath: string): Promise<string | null> {
	if (ffmpegMissing) return null;
	const amrPath = wavPath.replace(/\.wav$/i, ".amr");

	const result =
		await $`ffmpeg -y -i ${wavPath} -ar 8000 -ac 1 -c:a libopencore_amrnb -b:a 12.2k ${amrPath}`
			.quiet()
			.nothrow();

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString();
		if (/not found|ENOENT|command not found/i.test(stderr)) {
			ffmpegMissing = true;
			logger.debug("[tts] ffmpeg not found; amr conversion disabled for this process");
		} else {
			logger.debug(
				`[tts] ffmpeg amr conversion failed (exit ${result.exitCode}): ${stderr.slice(0, 300)}`,
			);
		}
		return null;
	}
	logger.debug(`[tts] ffmpeg wav→amr ok: ${wavPath} → ${amrPath}`);
	return amrPath;
}
