export interface TranscribeOptions {
	input: string;
	language?: string;
	apiKey: string;
	baseUrl?: string;
}

export interface Segment {
	start: number;
	end: number;
	text: string;
}

export interface TranscribeResult {
	text: string;
	segments: Segment[];
	language: string;
	duration: number;
}

export interface WhisperApiSegment {
	id: number;
	start: number;
	end: number;
	text: string;
}

export interface WhisperApiResponse {
	text: string;
	language: string;
	duration: number;
	segments: WhisperApiSegment[];
}

export const AUDIO_EXTENSIONS = new Set([
	".mp3",
	".wav",
	".m4a",
	".ogg",
	".opus",
	".flac",
	".aac",
	".wma",
]);

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB OpenAI limit
