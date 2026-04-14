import { Button } from "@/components/ui/button";
import type { RestartStatus } from "@/hooks/use-restart";
import { useLocale } from "@/i18n";

interface RestartOverlayProps {
	status: RestartStatus;
	onDismiss?: () => void;
}

export function RestartOverlay({ status, onDismiss }: RestartOverlayProps) {
	const { t } = useLocale();

	if (status === "idle" || status === "ready") return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
			<div className="flex flex-col items-center gap-4 text-center max-w-sm px-6">
				{status === "failed" ? (
					<>
						<svg className="size-10 text-destructive" viewBox="0 0 16 16" fill="none">
							<circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
							<path
								d="M8 5v3.5M8 10.5v.5"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
						<p className="text-sm text-destructive font-medium">{t("restart.failed")}</p>
					</>
				) : status === "manual" ? (
					<>
						<svg className="size-10 text-warm" viewBox="0 0 16 16" fill="none">
							<circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
							<path
								d="M8 4.5v4M8 11v.5"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
						<p className="text-sm font-medium">{t("restart.manual.title")}</p>
						<p className="text-sm text-muted-foreground">{t("restart.manual.message")}</p>
						{onDismiss && (
							<Button variant="outline" size="sm" onClick={onDismiss}>
								{t("common.ok")}
							</Button>
						)}
					</>
				) : (
					<>
						<div className="size-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
						<p className="text-sm text-muted-foreground">{t("restart.overlay.message")}</p>
					</>
				)}
			</div>
		</div>
	);
}
