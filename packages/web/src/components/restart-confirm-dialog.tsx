import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/i18n";

interface RestartConfirmDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}

export function RestartConfirmDialog({ open, onOpenChange, onConfirm }: RestartConfirmDialogProps) {
	const { t } = useLocale();

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("dialog.restartConfirmTitle")}</DialogTitle>
					<DialogDescription>{t("dialog.restartConfirmDescription")}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						variant="destructive"
						onClick={() => {
							onOpenChange(false);
							onConfirm();
						}}
					>
						{t("common.restart")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
