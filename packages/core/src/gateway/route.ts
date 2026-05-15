import type { ModelMessage } from "ai";
import type { RecapEntry } from "../recap/types";

export interface Route {
	id: string;
	provider?: string;
	voiceMode?: boolean;
	messages: ModelMessage[];
	createdAt: number;
	updatedAt: number;
	recaps?: RecapEntry[];
}
