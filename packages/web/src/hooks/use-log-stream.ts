// packages/web/src/hooks/use-log-stream.ts
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_LINES = 5000;
const HISTORY_LINES = 500;

export type LogStreamStatus = "connecting" | "connected" | "disconnected";

export interface UseLogStreamResult {
	lines: string[];
	paused: boolean;
	bufferedCount: number;
	status: LogStreamStatus;
	pause: () => void;
	resume: () => void;
	clear: () => void;
}

export function useLogStream(): UseLogStreamResult {
	const [lines, setLines] = useState<string[]>([]);
	const [paused, setPaused] = useState(false);
	const [bufferedCount, setBufferedCount] = useState(0);
	const [status, setStatus] = useState<LogStreamStatus>("connecting");
	const bufferRef = useRef<string[]>([]);
	const pausedRef = useRef(false);

	const appendLines = useCallback((incoming: string[]) => {
		if (incoming.length === 0) return;
		setLines((prev) => {
			const next = prev.concat(incoming);
			return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
		});
	}, []);

	useEffect(() => {
		let cancelled = false;
		let es: EventSource | null = null;

		(async () => {
			try {
				const res = await fetch(`/api/logs/tail?lines=${HISTORY_LINES}`);
				const body = await res.json();
				if (!cancelled && body?.success && Array.isArray(body.data?.lines)) {
					setLines(body.data.lines);
				}
			} catch {
				// ignore — start with empty
			}
			if (cancelled) return;

			es = new EventSource("/api/logs/stream");
			setStatus("connecting");
			es.onopen = () => setStatus("connected");
			es.onerror = () => {
				// CONNECTING means EventSource is auto-reconnecting; only CLOSED is truly disconnected
				if (es && es.readyState === EventSource.CLOSED) {
					setStatus("disconnected");
				} else {
					setStatus("connecting");
				}
			};
			es.onmessage = (ev) => {
				const line = ev.data;
				if (typeof line !== "string" || line.length === 0) return;
				if (pausedRef.current) {
					bufferRef.current.push(line);
					if (bufferRef.current.length > MAX_LINES) {
						bufferRef.current = bufferRef.current.slice(-MAX_LINES);
					}
					setBufferedCount(bufferRef.current.length);
				} else {
					appendLines([line]);
				}
			};
		})();

		return () => {
			cancelled = true;
			es?.close();
		};
	}, [appendLines]);

	const pause = useCallback(() => {
		pausedRef.current = true;
		setPaused(true);
	}, []);

	const resume = useCallback(() => {
		const buffered = bufferRef.current;
		bufferRef.current = [];
		pausedRef.current = false;
		setPaused(false);
		setBufferedCount(0);
		if (buffered.length > 0) {
			appendLines(buffered);
		}
	}, [appendLines]);

	const clear = useCallback(() => {
		setLines([]);
		bufferRef.current = [];
		setBufferedCount(0);
	}, []);

	return { lines, paused, bufferedCount, status, pause, resume, clear };
}
