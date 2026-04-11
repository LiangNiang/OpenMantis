import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createLogger } from "@openmantis/common/logger";

const logger = createLogger("core/config");

import { deepMerge } from "@openmantis/common/config/merge";
import { configSchema, type OpenMantisConfig } from "@openmantis/common/config/schema";
import { stripUnchangedPlaceholders } from "@openmantis/common/config/sensitive";

export interface UpdateResult {
	success: boolean;
	error?: string;
	/** True iff this call actually persisted changes to disk. */
	changed?: boolean;
}

type ChangeListener = (changedPaths: string[]) => void;

export class ConfigStore {
	private data: Record<string, any> = {};
	private state!: OpenMantisConfig;
	private listeners: Set<ChangeListener> = new Set();
	private configPath: string;
	private _restartRequired = false;

	constructor(configPath: string) {
		this.configPath = configPath;
	}

	/**
	 * Process-memory flag indicating that a config change was persisted since
	 * this process started. Cleared naturally on process restart.
	 */
	isRestartRequired(): boolean {
		return this._restartRequired;
	}

	async load(): Promise<void> {
		try {
			const file = Bun.file(this.configPath);
			if (await file.exists()) {
				this.data = await file.json();
			}
		} catch (err) {
			logger.warn("[config-store] failed to load config, starting fresh:", err);
			this.data = {};
		}
		this.state = configSchema.parse(this.data);
	}

	get(): OpenMantisConfig {
		return this.state;
	}

	getByPath(path: string): unknown {
		const parts = path.split(".");
		let current: any = this.state;
		for (const part of parts) {
			if (current === undefined || current === null) return undefined;
			current = current[part];
		}
		return current;
	}

	getRawData(): Record<string, any> {
		return { ...this.data };
	}

	hasConfig(): boolean {
		return Object.keys(this.data).length > 0;
	}

	async update(partial: Record<string, any>): Promise<UpdateResult> {
		const cleaned = stripUnchangedPlaceholders(partial, this.state as any);
		if (Object.keys(cleaned).length === 0) {
			return { success: true, changed: false };
		}
		const newData = deepMerge(this.data, cleaned);
		const parseResult = configSchema.safeParse(newData);
		if (!parseResult.success) {
			return { success: false, error: parseResult.error!.message };
		}
		this.data = newData;
		this.state = parseResult.data!;
		await this.persist();
		this._restartRequired = true;
		const changedPaths = this.computeChangedPaths(cleaned);
		this.emit(changedPaths);
		return { success: true, changed: true };
	}

	/**
	 * Reset all config (no keys) or specific top-level keys.
	 * Returns true iff raw data was actually mutated.
	 */
	async reset(keys?: string[]): Promise<boolean> {
		let mutated = false;
		if (keys?.length) {
			for (const key of keys) {
				if (key in this.data) {
					delete this.data[key];
					mutated = true;
				}
			}
		} else if (Object.keys(this.data).length > 0) {
			this.data = {};
			mutated = true;
		}
		if (!mutated) {
			return false;
		}
		this.state = configSchema.parse(this.data);
		await this.persist();
		this._restartRequired = true;
		this.emit(keys?.length ? keys : ["*"]);
		return true;
	}

	onChange(listener: ChangeListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(changedPaths: string[]): void {
		for (const listener of this.listeners) {
			try {
				listener(changedPaths);
			} catch (err) {
				logger.warn("[config-store] listener error:", err);
			}
		}
	}

	private async persist(): Promise<void> {
		try {
			await mkdir(dirname(this.configPath), { recursive: true });
			await Bun.write(this.configPath, JSON.stringify(this.data, null, 2));
		} catch (err) {
			logger.error("[config-store] failed to persist config:", err);
		}
	}

	private computeChangedPaths(partial: Record<string, any>, prefix = ""): string[] {
		const paths: string[] = [];
		for (const key of Object.keys(partial)) {
			const fullPath = prefix ? `${prefix}.${key}` : key;
			const val = partial[key];
			if (val !== null && typeof val === "object" && !Array.isArray(val)) {
				paths.push(...this.computeChangedPaths(val, fullPath));
			} else {
				paths.push(fullPath);
			}
		}
		return paths;
	}
}
