import type { ParsedQQAttachment, ParsedQQContent } from "./types";

/**
 * Parse QQ Bot API v2 message event payload into unified content format.
 *
 * Event types:
 * - C2C_MESSAGE_CREATE: data.author.user_openid
 * - GROUP_AT_MESSAGE_CREATE: data.author.member_openid, data.group_openid
 */
export function parseQQMessage(eventType: string, data: any): ParsedQQContent {
	const text: string = data.content ?? "";
	const msgId: string = data.id ?? "";

	const attachments: ParsedQQAttachment[] = [];
	if (Array.isArray(data.attachments)) {
		for (const att of data.attachments) {
			if (att.url) {
				attachments.push({
					url: att.url,
					contentType: att.content_type ?? "application/octet-stream",
					filename: att.filename ?? "attachment",
				});
			}
		}
	}

	return {
		text: text.trim(),
		attachments,
		msgId,
		userOpenId: eventType === "C2C_MESSAGE_CREATE" ? (data.author?.user_openid ?? "") : "",
		groupOpenId: eventType === "GROUP_AT_MESSAGE_CREATE" ? (data.group_openid ?? "") : undefined,
		memberOpenId:
			eventType === "GROUP_AT_MESSAGE_CREATE" ? (data.author?.member_openid ?? "") : undefined,
	};
}

/**
 * Build route ID for QQ channel.
 */
export function buildQQRouteId(isGroup: boolean, targetId: string): string {
	const prefix = isGroup ? "qq-group" : "qq-c2c";
	return `${prefix}-${targetId}-${Date.now()}`;
}

/**
 * Build channel ID for QQ channel.
 */
export function buildQQChannelId(isGroup: boolean, targetId: string): string {
	const prefix = isGroup ? "qq-group" : "qq-c2c";
	return `${prefix}-${targetId}`;
}

/**
 * Strip <@!bot_id> mention tags from group message content.
 */
export function stripQQMention(text: string): string {
	return text.replace(/<@!\w+>/g, "").trim();
}
