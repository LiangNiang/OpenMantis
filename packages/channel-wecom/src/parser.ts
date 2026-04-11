import type { BaseMessage } from "@wecom/aibot-node-sdk";
import type { ParsedWeComAttachment, ParsedWeComContent } from "./types";

export function parseWeComMessage(msg: BaseMessage): ParsedWeComContent {
	switch (msg.msgtype) {
		case "text":
			return { text: msg.text?.content ?? "", attachments: [] };

		case "image": {
			const attachments: ParsedWeComAttachment[] = [];
			if (msg.image?.url) {
				attachments.push({
					url: msg.image.url,
					aeskey: msg.image.aeskey,
					name: "image.png",
					resourceType: "image",
				});
			}
			return { text: "", attachments };
		}

		case "file": {
			const attachments: ParsedWeComAttachment[] = [];
			if (msg.file?.url) {
				attachments.push({
					url: msg.file.url,
					aeskey: msg.file.aeskey,
					name: "file",
					resourceType: "file",
				});
			}
			return { text: "[file]", attachments };
		}

		case "voice":
			// SDK's VoiceContent only has `content` (speech-to-text), no url/aeskey
			return { text: msg.voice?.content ?? "", attachments: [] };

		case "video": {
			const attachments: ParsedWeComAttachment[] = [];
			if (msg.video?.url) {
				attachments.push({
					url: msg.video.url,
					aeskey: msg.video.aeskey,
					name: "video.mp4",
					resourceType: "video",
				});
			}
			return { text: "", attachments };
		}

		case "mixed": {
			const texts: string[] = [];
			const attachments: ParsedWeComAttachment[] = [];
			for (const item of msg.mixed?.msg_item ?? []) {
				if (item.msgtype === "text" && item.text?.content) {
					texts.push(item.text.content);
				} else if (item.msgtype === "image" && item.image?.url) {
					attachments.push({
						url: item.image.url,
						aeskey: item.image.aeskey,
						name: "image.png",
						resourceType: "image",
					});
				}
			}
			return { text: texts.join("").trim(), attachments };
		}

		default:
			return { text: `[${msg.msgtype}]`, attachments: [] };
	}
}

export function buildWeComRouteId(channelId: string): string {
	return `wecom-${channelId}-${Date.now()}`;
}

/**
 * Strip @mention prefix from group chat messages.
 * WeCom group messages start with "@RobotName " when the bot is mentioned.
 */
export function stripAtMention(text: string): string {
	return text.replace(/^@\S+\s*/, "").trim();
}
