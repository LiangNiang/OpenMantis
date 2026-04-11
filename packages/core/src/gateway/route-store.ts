import { mkdir, readdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@openmantis/common/logger";
import { browserProfileDir } from "@openmantis/common/paths";

const logger = createLogger("core/gateway");

import type { ChannelRef, Route } from "./route";

export interface RouteSummary {
	id: string;
	modelId?: string;
	messageCount: number;
	connectedChannels: ChannelRef[];
	createdAt: number;
	updatedAt: number;
}

export class RouteStore {
	private cache = new Map<string, Route>();
	private cacheTime = new Map<string, number>();
	private dir: string;
	private initialized = false;
	private cdpActive: () => boolean;

	constructor(dir: string, cdpActive: () => boolean = () => false) {
		this.dir = dir;
		this.cdpActive = cdpActive;
	}

	private async ensureDir(): Promise<void> {
		if (!this.initialized) {
			await mkdir(this.dir, { recursive: true });
			this.initialized = true;
		}
	}

	private filePath(id: string): string {
		return join(this.dir, `${id}.json`);
	}

	async get(id: string): Promise<Route | undefined> {
		const cached = this.cache.get(id);
		if (cached) {
			try {
				const file = Bun.file(this.filePath(id));
				const stat = await file.stat();
				if (stat.mtimeMs <= (this.cacheTime.get(id) ?? 0)) return cached;
			} catch {
				this.cache.delete(id);
				this.cacheTime.delete(id);
				return undefined;
			}
		}

		try {
			const file = Bun.file(this.filePath(id));
			if (!(await file.exists())) return undefined;
			const data = await file.json();
			const route: Route = {
				id: data.id,
				provider: data.provider,
				originChannelType: data.originChannelType,
				originChannelId: data.originChannelId,
				messages: data.messages ?? [],
				connectedChannels: data.connectedChannels ?? [],
				createdAt: data.createdAt,
				updatedAt: data.updatedAt,
			};
			this.cache.set(id, route);
			this.cacheTime.set(id, Date.now());
			return route;
		} catch (err) {
			logger.warn(`[route-store] failed to load route ${id}:`, err);
			return undefined;
		}
	}

	async save(route: Route): Promise<void> {
		try {
			await this.ensureDir();
			route.updatedAt = Date.now();
			const data = JSON.stringify(
				{
					id: route.id,
					provider: route.provider,
					originChannelType: route.originChannelType,
					originChannelId: route.originChannelId,
					connectedChannels: route.connectedChannels,
					createdAt: route.createdAt,
					updatedAt: route.updatedAt,
					messages: route.messages,
				},
				null,
				2,
			);
			await Bun.write(this.filePath(route.id), data);
			this.cache.set(route.id, route);
			this.cacheTime.set(route.id, Date.now());
		} catch (err) {
			logger.warn("[route-store] failed to save route:", err);
		}
	}

	async delete(id: string): Promise<boolean> {
		this.cache.delete(id);
		this.cacheTime.delete(id);
		let ok = true;
		try {
			await unlink(this.filePath(id));
			logger.debug(`[route-store] deleted route: ${id}`);
		} catch (err) {
			logger.warn(`[route-store] failed to delete route ${id}:`, err);
			ok = false;
		}
		if (!this.cdpActive()) {
			try {
				await rm(browserProfileDir(id), { recursive: true, force: true });
			} catch (err) {
				logger.warn(`[route-store] failed to clean browser profile for ${id}:`, err);
			}
		}
		return ok;
	}

	async list(): Promise<RouteSummary[]> {
		try {
			await this.ensureDir();
			const files = await readdir(this.dir);
			const summaries: RouteSummary[] = [];
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				try {
					const raw = await Bun.file(join(this.dir, file)).json();
					summaries.push({
						id: raw.id,
						messageCount: raw.messages?.length ?? 0,
						connectedChannels: raw.connectedChannels ?? [],
						createdAt: raw.createdAt,
						updatedAt: raw.updatedAt,
					});
				} catch {
					// skip corrupt files
				}
			}
			return summaries;
		} catch {
			return [];
		}
	}

	async listByChannel(channelType: string, channelId: string): Promise<RouteSummary[]> {
		const all = await this.list();
		return all.filter((s) =>
			s.connectedChannels.some((c) => c.channelType === channelType && c.channelId === channelId),
		);
	}

	async create(id: string, channelType: string, channelId: string): Promise<Route> {
		const now = Date.now();
		const route: Route = {
			id,
			messages: [],
			connectedChannels: [{ channelType, channelId }],
			originChannelType: channelType,
			originChannelId: channelId,
			createdAt: now,
			updatedAt: now,
		};
		await this.save(route);
		return route;
	}

	async getOrCreate(id: string, channelType: string, channelId: string): Promise<Route> {
		const existing = await this.get(id);
		if (existing) {
			const channelExists = existing.connectedChannels.some(
				(c) => c.channelType === channelType && c.channelId === channelId,
			);
			if (!channelExists) {
				existing.connectedChannels.push({ channelType, channelId });
				await this.save(existing);
			}
			return existing;
		}
		return this.create(id, channelType, channelId);
	}

	generateId(): string {
		let id: string;
		do {
			id = crypto.randomUUID().slice(0, 8);
		} while (this.cache.has(id));
		return id;
	}
}
