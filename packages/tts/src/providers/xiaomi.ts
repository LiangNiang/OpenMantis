import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "@openmantis/common/logger";
import { TTS_DIR } from "@openmantis/common/paths";
import type {
	SynthesizeOptions,
	SynthesizeResult,
	SynthesizeStreamOptions,
	TtsProvider,
} from "@openmantis/common/types/tts";
import { pcmChunksToWav } from "../pcm";
import type { TtsConfig } from "../types";

const logger = createLogger("tts");

const DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1";
const MODEL_ID = "mimo-v2.5-tts";
let streamCompatLogged = false;

function wavDurationMs(wav: Buffer): number {
	// RIFF/WAV: byte rate at offset 28 (UInt32LE), data chunk size at offset 40 (UInt32LE)
	// We assume the standard 44-byte header layout written by Xiaomi or our pcm helper.
	if (wav.length < 44) return 0;
	const byteRate = wav.readUInt32LE(28);
	const dataSize = wav.readUInt32LE(40);
	if (byteRate === 0) return 0;
	return Math.round((dataSize / byteRate) * 1000);
}

function resolveCreds(config?: TtsConfig): { apiKey: string; baseUrl: string } {
	const tts = config?.xiaomiTts;
	const xiaomiProvider = config?.providers?.find((p) => p.provider === "xiaomi-mimo");
	const apiKey = tts?.apiKey ?? xiaomiProvider?.apiKey;
	if (!apiKey) {
		throw new Error("Xiaomi TTS API key 未配置（xiaomiTts.apiKey 或 xiaomi-mimo provider apiKey）");
	}
	const baseUrl = tts?.baseUrl ?? xiaomiProvider?.baseUrl ?? DEFAULT_BASE_URL;
	return { apiKey, baseUrl };
}

function buildMessages(text: string, style?: string, direction?: string) {
	const messages: Array<{ role: string; content: string }> = [];
	if (direction) messages.push({ role: "user", content: direction });
	const content = style ? `(${style})${text.trimStart()}` : text;
	messages.push({ role: "assistant", content });
	return messages;
}

function outputPath(): string {
	mkdirSync(TTS_DIR, { recursive: true });
	const ts = Date.now();
	const rand = Math.random().toString(36).slice(2, 8);
	return resolve(`${TTS_DIR}/${ts}-${rand}.wav`);
}

export async function synthesize(
	options: SynthesizeOptions,
	config?: TtsConfig,
): Promise<SynthesizeResult> {
	const { apiKey, baseUrl } = resolveCreds(config);
	const voice = options.voice ?? config?.xiaomiTts?.voice ?? "mimo_default";
	const style = options.style ?? config?.xiaomiTts?.style;
	const direction = options.direction ?? config?.xiaomiTts?.direction;

	logger.debug(
		`[tts] synthesize request: voice=${voice}, textLen=${options.text.length}, style=${style || "(none)"}, direction=${direction ? "(set)" : "(none)"}, baseUrl=${baseUrl}`,
	);

	const startMs = Date.now();
	const res = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"api-key": apiKey,
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: MODEL_ID,
			messages: buildMessages(options.text, style, direction),
			audio: { format: "wav", voice },
		}),
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Xiaomi TTS HTTP ${res.status}: ${body.slice(0, 500)}`);
	}

	const json = (await res.json()) as {
		choices?: Array<{ message?: { audio?: { data?: string } } }>;
	};
	const b64 = json.choices?.[0]?.message?.audio?.data;
	if (!b64) {
		throw new Error("Xiaomi TTS 返回为空（缺少 choices[0].message.audio.data）");
	}

	const buf = Buffer.from(b64, "base64");
	const durationMs = wavDurationMs(buf);
	const filePath = outputPath();
	await Bun.write(filePath, buf);
	logger.debug(`[tts] synthesized ${buf.length} bytes (${Date.now() - startMs}ms) → ${filePath}`);
	return { filePath, format: "wav", bytes: buf.length, durationMs };
}

/**
 * Stream pcm16 audio from Xiaomi MIMO TTS, materialize into a WAV file
 * once the stream completes. Returns the file path.
 *
 * Note: v2.5-tts streaming currently runs in compatibility mode (server emits
 * the full buffer once all inference completes), so there is no first-byte
 * latency advantage over non-streaming. API shape is unchanged.
 */
export async function synthesizeStream(
	options: SynthesizeStreamOptions,
	config?: TtsConfig,
): Promise<SynthesizeResult> {
	const { apiKey, baseUrl } = resolveCreds(config);
	const voice = options.voice ?? config?.xiaomiTts?.voice ?? "mimo_default";
	const style = options.style ?? config?.xiaomiTts?.style;
	const direction = options.direction ?? config?.xiaomiTts?.direction;

	if (!streamCompatLogged) {
		logger.info(
			"[tts] v2.5-tts streaming runs in compatibility mode — no first-byte latency improvement over non-stream",
		);
		streamCompatLogged = true;
	}

	logger.debug(
		`[tts] synthesize stream request: voice=${voice}, textLen=${options.text.length}, style=${style || "(none)"}, direction=${direction ? "(set)" : "(none)"}, baseUrl=${baseUrl}`,
	);

	const startMs = Date.now();
	const res = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"api-key": apiKey,
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		},
		body: JSON.stringify({
			model: MODEL_ID,
			messages: buildMessages(options.text, style, direction),
			audio: { format: "pcm16", voice },
			stream: true,
		}),
	});

	if (!res.ok || !res.body) {
		const body = res.body ? await res.text() : "(no body)";
		throw new Error(`Xiaomi TTS stream HTTP ${res.status}: ${body.slice(0, 500)}`);
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	const chunks: Buffer[] = [];
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		while (true) {
			const idx = buffer.indexOf("\n\n");
			if (idx === -1) break;
			const event = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);

			for (const line of event.split("\n")) {
				if (!line.startsWith("data:")) continue;
				const payload = line.slice(5).trim();
				if (!payload || payload === "[DONE]") continue;
				try {
					const parsed = JSON.parse(payload) as {
						choices?: Array<{ delta?: { audio?: { data?: string } } }>;
					};
					const b64 = parsed.choices?.[0]?.delta?.audio?.data;
					if (b64) chunks.push(Buffer.from(b64, "base64"));
				} catch (err) {
					logger.debug(`[tts] sse parse error: ${(err as Error).message}`);
				}
			}
		}
	}

	if (chunks.length === 0) {
		throw new Error("Xiaomi TTS stream 返回为空");
	}

	const totalPcmBytes = chunks.reduce((n, c) => n + c.length, 0);
	const durationMs = Math.round((totalPcmBytes / (24000 * 2)) * 1000);
	const filePath = await pcmChunksToWav(chunks, 24000);
	logger.debug(
		`[tts] stream synthesized ${totalPcmBytes} bytes (${Date.now() - startMs}ms) → ${filePath}`,
	);
	return { filePath, format: "wav", bytes: totalPcmBytes, durationMs };
}

export const xiaomiProvider: TtsProvider<TtsConfig> = {
	name: "xiaomi-mimo",
	synthesize,
	synthesizeStream,
	isConfigured: (config) => {
		const direct = config.xiaomiTts?.apiKey;
		const fromProvider = config.providers?.find((p) => p.provider === "xiaomi-mimo")?.apiKey;
		return Boolean(direct || fromProvider);
	},
};
