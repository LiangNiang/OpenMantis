// === inlined from packages/core/src/tts/providers/xiaomi.ts ===

export interface SynthesizeOptions {
	text: string;
	voice?: string;
	user?: string;
}

export interface SynthesizeResult {
	filePath: string;
	format: "wav";
	bytes: number;
	durationMs: number;
}

export interface SynthesizeStreamOptions {
	text: string;
	voice?: string;
	user?: string;
}

export interface TtsProvider<TConfig = unknown> {
	name: string;
	synthesize(opts: SynthesizeOptions, config: TConfig): Promise<SynthesizeResult>;
	synthesizeStream(opts: SynthesizeStreamOptions, config: TConfig): Promise<SynthesizeResult>;
	isConfigured(config: TConfig): boolean;
}
