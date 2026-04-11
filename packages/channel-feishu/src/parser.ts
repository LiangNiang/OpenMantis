import type { Mention, ParsedAttachment, ParsedFeishuContent } from "./types";

export function parseFeishuContent(messageType: string, content: string): ParsedFeishuContent {
	try {
		const parsed = JSON.parse(content);
		switch (messageType) {
			case "text":
				return { text: parsed.text ?? "[text]", attachments: [] };
			case "image":
				return {
					text: "",
					attachments: parsed.image_key
						? [
								{
									key: parsed.image_key,
									name: "image.png",
									resourceType: "image",
								},
							]
						: [],
				};
			case "post": {
				const texts: string[] = [];
				const attachments: ParsedAttachment[] = [];
				if (parsed.title) texts.push(parsed.title);
				const paragraphs: any[][] = parsed.content ?? [];
				for (const paragraph of paragraphs) {
					for (const el of paragraph) {
						if (el.tag === "text") {
							texts.push(el.text ?? "");
						} else if (el.tag === "a") {
							texts.push(el.text ?? el.href ?? "");
						} else if (el.tag === "at") {
							// skip mentions, handled separately
						} else if (el.tag === "img" && el.image_key) {
							attachments.push({
								key: el.image_key,
								name: "image.png",
								resourceType: "image",
							});
						}
					}
				}
				return { text: texts.join("").trim(), attachments };
			}
			case "file":
				return {
					text: `[file: ${parsed.file_name ?? "unknown"}]`,
					attachments: parsed.file_key
						? [
								{
									key: parsed.file_key,
									name: parsed.file_name ?? "unknown",
									resourceType: "file",
								},
							]
						: [],
				};
			default:
				return { text: `[${messageType}]`, attachments: [] };
		}
	} catch {
		return { text: `[${messageType}]`, attachments: [] };
	}
}

export function buildFeishuRouteId(channelType: string, chatId: string): string {
	return `${channelType}-${chatId}-${Date.now()}`;
}

export function stripMention(text: string, mentions: Mention[]): string {
	let result = text;
	for (const mention of mentions) {
		result = result.replaceAll(mention.key, "");
	}
	return result.trim();
}
