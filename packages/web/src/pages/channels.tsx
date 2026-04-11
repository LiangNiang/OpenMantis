import { ChannelsForm } from "@/components/channels-form";
import { useDashboardContext } from "@/layouts/dashboard-context";

export function ChannelsPage() {
	const ctx = useDashboardContext();
	return (
		<ChannelsForm
			values={ctx.channelsValues}
			onChange={ctx.setChannelsValues}
			providerNames={ctx.providerNames}
		/>
	);
}
