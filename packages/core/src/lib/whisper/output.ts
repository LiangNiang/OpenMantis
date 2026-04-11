import type { Segment, WhisperApiResponse } from "./types";

function formatSrtTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const ms = Math.round((seconds % 1) * 1000);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function mergeChunkResults(results: { response: WhisperApiResponse; offsetSec: number }[]): {
	segments: Segment[];
	text: string;
	language: string;
	duration: number;
} {
	const allSegments: Segment[] = [];
	let lastEnd = -1;

	for (const { response, offsetSec } of results) {
		for (const seg of response.segments) {
			const start = seg.start + offsetSec;
			const end = seg.end + offsetSec;

			if (start < lastEnd - 0.5) {
				continue;
			}

			allSegments.push({ start, end, text: seg.text.trim() });
			lastEnd = end;
		}
	}

	const text = allSegments.map((s) => s.text).join("\n");
	const language = results[0]?.response.language ?? "unknown";
	const duration = allSegments.length > 0 ? allSegments[allSegments.length - 1]!.end : 0;

	return { segments: allSegments, text, language, duration };
}

export function generateSrt(segments: Segment[]): string {
	return segments
		.map(
			(seg, i) =>
				`${i + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.text}\n`,
		)
		.join("\n");
}
