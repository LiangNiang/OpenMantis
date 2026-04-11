import type * as Lark from "@larksuiteoapi/node-sdk";

const clients = new Map<string, Lark.Client>();
const botOpenIds = new Map<string, string>();

export function setFeishuClient(name: string, client: Lark.Client): void {
	clients.set(name, client);
}

export function getFeishuClient(channelType: string): Lark.Client | null {
	const name = channelType.startsWith("feishu:") ? channelType.slice(7) : channelType;
	return clients.get(name) ?? null;
}

export function setBotOpenId(name: string, openId: string): void {
	botOpenIds.set(name, openId);
}

export function getBotOpenId(channelType: string): string | null {
	const name = channelType.startsWith("feishu:") ? channelType.slice(7) : channelType;
	return botOpenIds.get(name) ?? null;
}
