// src/gateway/channel-bindings.ts
import { createLogger } from "@openmantis/common/logger";

const logger = createLogger("core/gateway");

interface ChannelBinding {
	routeId: string;
	provider?: string;
}

export class ChannelBindings {
	private bindings: Record<string, Record<string, ChannelBinding>> = {};
	private filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	async load(): Promise<void> {
		try {
			const file = Bun.file(this.filePath);
			if (await file.exists()) {
				const raw = await file.json();
				// Migrate old format: string values → ChannelBinding objects
				for (const channelType of Object.keys(raw)) {
					if (!this.bindings[channelType]) this.bindings[channelType] = {};
					for (const [chatId, value] of Object.entries(raw[channelType])) {
						if (typeof value === "string") {
							this.bindings[channelType][chatId] = { routeId: value };
						} else {
							this.bindings[channelType][chatId] = value as ChannelBinding;
						}
					}
				}
			}
		} catch (err) {
			logger.warn("[channel-bindings] failed to load:", err);
			this.bindings = {};
		}
	}

	get(channelType: string, chatId: string): string | undefined {
		return this.bindings[channelType]?.[chatId]?.routeId;
	}

	getBinding(channelType: string, chatId: string): ChannelBinding | undefined {
		return this.bindings[channelType]?.[chatId];
	}

	getProvider(channelType: string, chatId: string): string | undefined {
		return this.bindings[channelType]?.[chatId]?.provider;
	}

	async set(channelType: string, chatId: string, routeId: string): Promise<void> {
		if (!this.bindings[channelType]) {
			this.bindings[channelType] = {};
		}
		const existing = this.bindings[channelType][chatId];
		this.bindings[channelType][chatId] = { ...existing, routeId };
		await this.persist();
	}

	async setProvider(channelType: string, chatId: string, provider: string): Promise<void> {
		if (!this.bindings[channelType]) {
			this.bindings[channelType] = {};
		}
		const existing = this.bindings[channelType][chatId];
		if (existing) {
			existing.provider = provider;
		} else {
			this.bindings[channelType][chatId] = { routeId: "", provider };
		}
		await this.persist();
	}

	async delete(channelType: string, chatId: string): Promise<void> {
		if (this.bindings[channelType]) {
			delete this.bindings[channelType][chatId];
			await this.persist();
		}
	}

	async deleteByRouteId(routeId: string): Promise<void> {
		let changed = false;
		for (const channelType of Object.keys(this.bindings)) {
			const channelBindings = this.bindings[channelType];
			if (!channelBindings) continue;
			for (const [chatId, binding] of Object.entries(channelBindings)) {
				if (binding.routeId === routeId) {
					delete channelBindings[chatId];
					changed = true;
				}
			}
		}
		if (changed) await this.persist();
	}

	private async persist(): Promise<void> {
		try {
			await Bun.write(this.filePath, JSON.stringify(this.bindings, null, 2));
		} catch (err) {
			logger.warn("[channel-bindings] failed to persist:", err);
		}
	}
}
