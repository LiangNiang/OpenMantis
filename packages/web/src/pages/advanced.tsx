import { AdvancedForm } from "@/components/advanced-form";
import { useDashboardContext } from "@/layouts/dashboard-context";

export function AdvancedPage() {
	const ctx = useDashboardContext();
	return <AdvancedForm values={ctx.advancedValues} onChange={ctx.setAdvancedValues} />;
}
