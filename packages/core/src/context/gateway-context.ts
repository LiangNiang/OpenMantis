import type { Gateway } from "../gateway/gateway";

let currentGateway: Gateway | null = null;

export function setGateway(gateway: Gateway): void {
	currentGateway = gateway;
}

export function getGateway(): Gateway | null {
	return currentGateway;
}
