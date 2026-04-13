import { useRestart } from "@/hooks/use-restart";
import { useConfig } from "@/hooks/use-config";
import { useLocale } from "@/i18n";
import { Button } from "@/components/ui/button";
import { RestartConfirmDialog } from "@/components/restart-confirm-dialog";
import { RestartOverlay } from "@/components/restart-overlay";
import { useState } from "react";

export function RestartBanner() {
	const { restartRequired } = useConfig();
	const { t } = useLocale();
	const { status, triggerRestart } = useRestart();
	const [showConfirm, setShowConfirm] = useState(false);

	if (!restartRequired && status === "idle") return null;

	return (
		<>
			<div className="border-b border-warm/30 bg-warm/10 px-6 py-3 flex items-center gap-3 text-foreground">
				<svg
					className="size-5 shrink-0 text-warm"
					viewBox="0 0 16 16"
					fill="none"
					aria-hidden="true"
				>
					<circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
					<path
						d="M8 4.5v4M8 11v.5"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
				</svg>
				<div className="text-sm flex-1">
					<p className="font-medium">{t("banner.restartRequired.title")}</p>
					<p className="text-muted-foreground mt-0.5">
						{t("banner.restartRequired.description")}
					</p>
				</div>
				<Button
					size="sm"
					variant="outline"
					onClick={() => setShowConfirm(true)}
					disabled={status !== "idle"}
				>
					{status === "idle" ? t("restart.banner.button") : t("common.restarting")}
				</Button>
			</div>
			<RestartConfirmDialog
				open={showConfirm}
				onOpenChange={setShowConfirm}
				onConfirm={triggerRestart}
			/>
			<RestartOverlay status={status} />
		</>
	);
}
