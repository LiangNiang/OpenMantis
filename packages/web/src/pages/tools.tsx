import { ToolsForm } from "@/components/tools-form";
import { useDashboardContext } from "@/layouts/dashboard-context";

export function ToolsPage() {
	const ctx = useDashboardContext();
	return <ToolsForm values={ctx.toolsValues} onChange={ctx.setToolsValues} />;
}
