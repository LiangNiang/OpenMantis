// packages/web/src/pages/logs.tsx
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useLogStream } from "@/hooks/use-log-stream";
import { useLocale } from "@/i18n";

const LEVEL_RE = /\b(ERROR|WARN|INFO|DEBUG)\b/;
const LEVEL_CLASS: Record<string, string> = {
	ERROR: "text-destructive font-semibold",
	WARN: "text-warm font-semibold",
	INFO: "text-primary",
	DEBUG: "text-muted-foreground",
};

const LogLine = memo(function LogLine({ line }: { line: string }) {
	const m = LEVEL_RE.exec(line);
	if (!m) {
		return <div className="whitespace-pre cv-auto">{line}</div>;
	}
	const before = line.slice(0, m.index);
	const level = m[0];
	const after = line.slice(m.index + level.length);
	return (
		<div className="whitespace-pre cv-auto">
			{before}
			<span className={LEVEL_CLASS[level]}>{level}</span>
			{after}
		</div>
	);
});

export function LogsPage() {
	const { t } = useLocale();
	const { lines, paused, bufferedCount, status, pause, resume, clear } = useLogStream();
	const rootRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const followRef = useRef(true);
	const [atBottom, setAtBottom] = useState(true);

	const getViewport = useCallback(() => {
		if (viewportRef.current) return viewportRef.current;
		const root = rootRef.current;
		if (!root) return null;
		viewportRef.current = root.querySelector<HTMLDivElement>(
			"[data-slot='scroll-area-viewport']",
		);
		return viewportRef.current;
	}, []);

	// Follow: 列表更新后若处于底部则滚动到底部
	useEffect(() => {
		const el = getViewport();
		if (!el) return;
		if (followRef.current) {
			el.scrollTop = el.scrollHeight;
		}
	}, [lines, getViewport]);

	const onScroll = useCallback(() => {
		const el = getViewport();
		if (!el) return;
		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		const isAtBottom = distanceFromBottom < 50;
		followRef.current = isAtBottom;
		setAtBottom(isAtBottom);
	}, [getViewport]);

	useEffect(() => {
		const el = getViewport();
		if (!el) return;
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [onScroll, getViewport]);

	const scrollToBottom = useCallback(() => {
		const el = getViewport();
		if (!el) return;
		el.scrollTop = el.scrollHeight;
		followRef.current = true;
		setAtBottom(true);
	}, [getViewport]);

	return (
		<div className="flex flex-col h-[calc(100vh-5rem)]">
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-3">
					<h2 className="font-display text-2xl font-semibold tracking-tight">
						{t("logs.title")}
					</h2>
					<span
						className={`inline-flex items-center gap-1.5 text-xs ${
							status === "connected"
								? "text-primary"
								: status === "connecting"
									? "text-warm"
									: "text-destructive"
						}`}
					>
						<span
							className={`size-2 rounded-full ${
								status === "connected"
									? "bg-primary animate-pulse"
									: status === "connecting"
										? "bg-warm animate-pulse"
										: "bg-destructive"
							}`}
						/>
						{status === "connected"
							? t("logs.connected")
							: status === "connecting"
								? t("logs.connecting")
								: t("logs.disconnected")}
					</span>
					{paused && (
						<span className="inline-flex items-center gap-1.5 text-xs font-medium text-warm px-2 py-0.5 rounded-full border border-warm/40 bg-warm/10">
							<svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
								<rect x="4" y="3" width="3" height="10" rx="0.5" />
								<rect x="9" y="3" width="3" height="10" rx="0.5" />
							</svg>
							{t("logs.pausedBadge").replace("{count}", String(bufferedCount))}
						</span>
					)}
				</div>
				<div className="flex gap-2">
					<Button
						variant={paused ? "default" : "outline"}
						size="sm"
						onClick={paused ? resume : pause}
					>
						{paused ? (
							<svg className="size-3.5 mr-1" viewBox="0 0 16 16" fill="currentColor">
								<path d="M4 3l9 5-9 5z" />
							</svg>
						) : (
							<svg className="size-3.5 mr-1" viewBox="0 0 16 16" fill="currentColor">
								<rect x="4" y="3" width="3" height="10" rx="0.5" />
								<rect x="9" y="3" width="3" height="10" rx="0.5" />
							</svg>
						)}
						{paused ? t("logs.resume") : t("logs.pause")}
					</Button>
					<Button variant="outline" size="sm" onClick={clear}>
						{t("logs.clear")}
					</Button>
					<Button variant="outline" size="sm" asChild>
						<a href="/api/logs/download" download>
							{t("logs.download")}
						</a>
					</Button>
				</div>
			</div>

			<ScrollArea
				ref={rootRef}
				className="flex-1 min-h-0 rounded-lg border border-border/60 bg-card/50 font-mono text-base leading-relaxed"
			>
				<div className="p-3">
						{lines.map((line, idx) => (
							<LogLine key={idx} line={line} />
						))}
					</div>
				<ScrollBar orientation="horizontal" />
			</ScrollArea>

			{!atBottom && (
				<button
					type="button"
					onClick={scrollToBottom}
					className="self-end mt-2 text-xs text-muted-foreground hover:text-primary"
				>
					{t("logs.scrollToBottom")}
				</button>
			)}
		</div>
	);
}
