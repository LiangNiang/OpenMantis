import { useOutletContext } from "react-router-dom";
import type { ProviderEntry } from "@/components/provider-form";
import type { ToolsFormValues } from "@/components/tools-form";

export interface ChannelsValues {
	channels: string[];
	feishu?: Array<{
		name: string;
		appId: string;
		appSecret: string;
		provider?: string;
		tts?: { enabled: boolean; provider: "xiaomi-mimo" };
	}>;
	wecom?: {
		botId: string;
		secret: string;
		provider?: string;
		tts?: { enabled: boolean; provider: "xiaomi-mimo" };
	};
	qq?: { appId: string; clientSecret: string; sandbox: boolean; provider?: string };
}

export interface ProviderValues {
	defaultProvider: string;
	providers: ProviderEntry[];
}

export interface AdvancedValues {
	systemPrompt: string;
	maxToolRoundtrips: number;
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
	providerNames: string[];
}

export function useDashboardContext(): DashboardOutletContext {
	return useOutletContext<DashboardOutletContext>();
}
