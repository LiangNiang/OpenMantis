import { ProviderForm } from "@/components/provider-form";
import { useDashboardContext } from "@/layouts/dashboard-context";

export function ProviderPage() {
	const ctx = useDashboardContext();
	return <ProviderForm values={ctx.providerValues} onChange={ctx.setProviderValues} />;
}
