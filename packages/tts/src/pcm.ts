import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { TTS_DIR } from "@openmantis/common/paths";

/** Build a 44-byte RIFF/WAV header for PCM16 mono. */
function buildWavHeader(dataBytes: number, sampleRate: number): Buffer {
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + dataBytes, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(dataBytes, 40);
	return header;
}

export async function pcmChunksToWav(chunks: Buffer[], sampleRate = 24000): Promise<string> {
	mkdirSync(TTS_DIR, { recursive: true });
	const data = Buffer.concat(chunks);
	const header = buildWavHeader(data.length, sampleRate);
	const wav = Buffer.concat([header, data]);
	const ts = Date.now();
	const rand = Math.random().toString(36).slice(2, 8);
	const filePath = resolve(`${TTS_DIR}/${ts}-${rand}.wav`);
	await Bun.write(filePath, wav);
	return filePath;
}
