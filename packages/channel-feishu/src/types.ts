export interface FeishuConfig {
	name: string;
	appId: string;
	appSecret: string;
}

export interface Mention {
	key: string;
	name: string;
}

export interface ParsedAttachment {
	key: string;
	name: string;
	resourceType: "image" | "file";
}

export interface ParsedFeishuContent {
	text: string;
	attachments: ParsedAttachment[];
}
