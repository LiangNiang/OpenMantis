import { useOutletContext } from "react-router-dom";
import type { ProviderEntry } from "@/components/provider-form";
import type { ToolsFormValues } from "@/components/tools-form";

export interface ChannelsValues {
	channels: string[];
	feishu?: Array<{
		name: string;
		appId: string;
		appSecret: string;
	}>;
	wecom?: {
		botId: string;
		secret: string;
	};
	qq?: { appId: string; clientSecret: string; sandbox: boolean };
}

export interface ProviderValues {
	defaultProvider: string;
	providers: ProviderEntry[];
}

export interface AdvancedValues {
	systemPrompt: string;
	maxToolRoundtrips: number;
	autoNewRoute: {
		enabled: boolean;
		idleMinutes: number;
		recap: boolean;
	};
}

export interface DashboardOutletContext {
	providerValues: ProviderValues;
	setProviderValues: React.Dispatch<React.SetStateAction<ProviderValues>>;
	channelsValues: ChannelsValues;
	setChannelsValues: React.Dispatch<React.SetStateAction<ChannelsValues>>;
	toolsValues: ToolsFormValues;
	setToolsValues: React.Dispatch<React.SetStateAction<ToolsFormValues>>;
	advancedValues: AdvancedValues;
	setAdvancedValues: React.Dispatch<React.SetStateAction<AdvancedValues>>;
}

export function useDashboardContext(): DashboardOutletContext {
	return useOutletContext<DashboardOutletContext>();
}
