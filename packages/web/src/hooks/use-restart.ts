// packages/web/src/hooks/use-restart.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export type RestartStatus =
	| "idle"
	| "restarting"
	| "reconnecting"
	| "ready"
	| "failed"
	| "manual";

const POLL_INTERVAL = 1000;
const TIMEOUT = 30_000;

export function useRestart() {
	const [status, setStatus] = useState<RestartStatus>("idle");
	const startTimeRef = useRef<number | null>(null);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const cleanup = useCallback(() => {
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
	}, []);

	useEffect(() => cleanup, [cleanup]);

	const pollForReady = useCallback(() => {
		timerRef.current = setInterval(async () => {
			try {
				const data = await api.getStatus();
				if (startTimeRef.current !== null && data.startTime !== startTimeRef.current) {
					cleanup();
					setStatus("ready");
					setTimeout(() => window.location.reload(), 500);
				}
			} catch {
				// Server not ready yet, keep polling
				setStatus("reconnecting");
			}
		}, POLL_INTERVAL);

		timeoutRef.current = setTimeout(() => {
			cleanup();
			setStatus("failed");
		}, TIMEOUT);
	}, [cleanup]);

	const triggerRestart = useCallback(async () => {
		try {
			const statusData = await api.getStatus();
			startTimeRef.current = statusData.startTime;
			setStatus("restarting");
			const result = await api.restart();
			if (result.devMode) {
				setStatus("manual");
				return;
			}
			pollForReady();
		} catch {
			setStatus("failed");
		}
	}, [pollForReady]);

	const dismiss = useCallback(() => {
		cleanup();
		setStatus("idle");
	}, [cleanup]);

	return { status, triggerRestart, dismiss };
}
