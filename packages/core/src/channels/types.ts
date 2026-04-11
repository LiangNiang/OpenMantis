import type {
	ChannelAdapter as ContractChannelAdapter,
	GatewayResponse as ContractGatewayResponse,
	OnMessageCallback as ContractOnMessageCallback,
} from "@openmantis/common/types/channels";
import type { StreamEvent } from "../gateway/stream-events";

export type {
	FileAttachment,
	IncomingMessage,
	OutgoingMessage,
	ToolCallInfo,
} from "@openmantis/common/types/channels";

export type GatewayResponse = ContractGatewayResponse<StreamEvent>;
export type OnMessageCallback = ContractOnMessageCallback<StreamEvent>;
export type ChannelAdapter = ContractChannelAdapter<StreamEvent>;
