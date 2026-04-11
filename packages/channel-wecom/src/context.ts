import type { WSClient } from "@wecom/aibot-node-sdk";

let wecomClient: WSClient | null = null;

export function setWecomClient(client: WSClient): void {
	wecomClient = client;
}

export function getWecomClient(): WSClient | null {
	return wecomClient;
}
