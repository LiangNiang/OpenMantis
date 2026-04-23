export interface RecapSection {
	goal: string;
	decisions: string;
	changes: string;
	todos: string;
}

export interface RecapResult {
	heading: string;
	sections: RecapSection;
}

export interface RecapEntry {
	id: string;
	createdAt: number;
	messageCount: number;
	provider: string;
	modelId: string;
	result: RecapResult;
}

export interface GenerateRecapOutput {
	result: RecapResult;
	provider: string;
	modelId: string;
}
