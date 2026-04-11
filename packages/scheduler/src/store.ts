// src/scheduler/store.ts
import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@openmantis/common/logger";
import type { Schedule, ScheduledTask } from "@openmantis/common/types/scheduler";

const logger = createLogger("scheduler");

export interface ScheduleSummary {
	id: string;
	description?: string;
	prompt: string;
	schedule: Schedule;
	status: "active" | "paused" | "completed";
	executionCount: number;
	nextExecutionAt: number;
	createdAt: number;
}

export class ScheduleStore {
	private dir: string;
	private initialized = false;

	constructor(dir: string) {
		this.dir = dir;
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

	async get(id: string): Promise<ScheduledTask | undefined> {
		try {
			const file = Bun.file(this.filePath(id));
			if (!(await file.exists())) return undefined;
			const data = await file.json();

			return {
				id: data.id,
				prompt: data.prompt,
				schedule: data.schedule,
				originChannelType: data.originChannelType,
				originChannelId: data.originChannelId,
				targetChannelType: data.targetChannelType,
				targetChannelId: data.targetChannelId,
				status: data.status,
				maxExecutions: data.maxExecutions,
				executionCount: data.executionCount,
				lastExecutedAt: data.lastExecutedAt,
				nextExecutionAt: data.nextExecutionAt,
				createdAt: data.createdAt,
				description: data.description,
			};
		} catch (err) {
			logger.warn(`[schedule-store] failed to load task ${id}:`, err);
			return undefined;
		}
	}

	async save(task: ScheduledTask): Promise<void> {
		try {
			await this.ensureDir();
			const data = JSON.stringify(task, null, 2);
			await Bun.write(this.filePath(task.id), data);
		} catch (err) {
			logger.warn("[schedule-store] failed to save task:", err);
		}
	}

	async delete(id: string): Promise<boolean> {
		try {
			await unlink(this.filePath(id));
			logger.debug(`[schedule-store] deleted task: ${id}`);
			return true;
		} catch (err) {
			logger.warn(`[schedule-store] failed to delete task ${id}:`, err);
			return false;
		}
	}

	async list(): Promise<ScheduleSummary[]> {
		try {
			await this.ensureDir();
			const files = await readdir(this.dir);
			const summaries: ScheduleSummary[] = [];
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				try {
					const raw = await Bun.file(join(this.dir, file)).json();
					summaries.push({
						id: raw.id,
						description: raw.description,
						prompt: raw.prompt,
						schedule: raw.schedule,
						status: raw.status,
						executionCount: raw.executionCount,
						nextExecutionAt: raw.nextExecutionAt,
						createdAt: raw.createdAt,
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

	/** List all tasks with full data, reading each file from disk */
	async listFull(): Promise<ScheduledTask[]> {
		try {
			await this.ensureDir();
			const files = await readdir(this.dir);
			const results = await Promise.all(
				files.filter((f) => f.endsWith(".json")).map((f) => this.get(f.replace(/\.json$/, ""))),
			);
			return results.filter((t): t is ScheduledTask => t != null);
		} catch {
			return [];
		}
	}

	async generateId(): Promise<string> {
		await this.ensureDir();
		const files = await readdir(this.dir);
		const existingIds = new Set(
			files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")),
		);
		let id: string;
		do {
			id = `sch_${crypto.randomUUID().slice(0, 5)}`;
		} while (existingIds.has(id));
		return id;
	}
}
