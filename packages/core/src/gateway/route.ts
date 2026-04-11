import type { ModelMessage } from "ai";

export interface ChannelRef {
	channelType: string;
	channelId: string;
}

export interface Route {
	id: string;
	provider?: string;
	voiceMode?: boolean;
	messages: ModelMessage[];
	connectedChannels: ChannelRef[];
	originChannelType: string;
	originChannelId: string;
	createdAt: number;
	updatedAt: number;
}
