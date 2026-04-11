export interface WeComConfig {
	botId: string;
	secret: string;
}

export interface ParsedWeComAttachment {
	url: string;
	aeskey: string;
	name: string;
	resourceType: "image" | "file" | "voice" | "video";
}

export interface ParsedWeComContent {
	text: string;
	attachments: ParsedWeComAttachment[];
}
