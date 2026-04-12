/** Well-known values for IncomingMessage.metadata.source */
export const MESSAGE_SOURCE = {
	SCHEDULER: "scheduler",
} as const;

export interface FileAttachment {
	path: string;
	fileName: string;
	mimeType?: string;
	size: number;
}

export interface IncomingMessage {
	channelType: string;
	channelId: string;
	routeId: string;
	content: string;
	files?: FileAttachment[];
	metadata?: Record<string, unknown>;
}

export interface ToolCallInfo {
	name: string;
	args: Record<string, unknown>;
	result: unknown;
}

export interface OutgoingMessage {
	content: string;
	toolCalls?: ToolCallInfo[];
}

export interface GatewayResponse<TStreamEvent = unknown> {
	stream: AsyncIterable<TStreamEvent>;
	response: Promise<OutgoingMessage>;
}

export type OnMessageCallback<TStreamEvent = unknown> = (
	message: IncomingMessage,
) => Promise<GatewayResponse<TStreamEvent>>;

export interface ChannelAdapter<TStreamEvent = unknown> {
	type: string;
	init(onMessage: OnMessageCallback<TStreamEvent>): Promise<void>;
	run(): Promise<void>;
	stop(): Promise<void>;
	pushMessage?(channelId: string, content: string): Promise<void>;
}
